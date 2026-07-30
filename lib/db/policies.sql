-- ============================================================================
-- ImpactStudy — RLS policies, identity plumbing, and grants
-- ----------------------------------------------------------------------------
-- Day 3 (Phase 0). Tenant-isolation model per 06_Technical_Architecture.md +
-- baseline-corpus carve-out per 17_Baseline_Curriculum_Corpus.md.
--
-- IDEMPOTENT: safe to re-run. Every object is dropped-if-exists then recreated.
--
-- ⚠️  SCHEMA CHANGES GO THROUGH MIGRATIONS (Slice B.5): `drizzle-kit generate`
--     → `pnpm db:migrate`. Migrations never touch RLS. `db:push` is GONE from
--     package.json — it silently DISABLED RLS on every table (it reconciles the
--     DB to the Drizzle schema, which doesn't declare RLS), which was one
--     forgotten chain away from a fully open database. `pnpm db:migrate` is
--     chained to re-apply this file and then ASSERT rowsecurity is ON for every
--     public table — it fails loudly otherwise.
--
-- HOW TO APPLY (pick one):
--   1. pnpm db:policies (tsx lib/db/apply-policies.ts — includes the RLS-on
--      assertion).
--   2. Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   3. psql "$DIRECT_URL" -f lib/db/policies.sql
--      (DIRECT_URL = session-mode pooler, port 5432 — NOT the 6543 runtime URL.
--       Run db:migrate FIRST so the tables exist before we policy them.)
--
-- TWO DATA PATHS — READ THIS:
--   * supabase-js with the PUBLISHABLE key talks to PostgREST as the
--     `authenticated` (or `anon`) role. RLS below IS enforced on this path.
--     This is the path that "couldn't read anything" before today.
--   * Drizzle (lib/db) connects via DATABASE_URL as the Postgres role, which
--     BYPASSES RLS by design. Server-side Drizzle queries MUST keep filtering
--     tenant_id in code (doc 06 §3). RLS here is defense-in-depth + the gate for
--     the client path. Do not rely on RLS to scope Drizzle reads.
--
-- WRITES IN PHASE 0: baseline corpus + seed data are written via the
-- service-role key (bypasses RLS) in admin/seed scripts. The write policies
-- below are staff-scoped for the app paths that land first (students, parent
-- links, corpus subscriptions). Everything else is read-only to `authenticated`
-- until its feature ships.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Identity plumbing: mirror auth.users -> public.users on signup
-- ----------------------------------------------------------------------------
-- Magic-link signup for a brand-new user (e.g. a parent) must create the
-- matching public.users row, or memberships/student_parents FKs have nothing to
-- point at. SECURITY DEFINER so the trigger can write past RLS.
--
-- THE STALE-EMAIL GUARD (Slice D — found by the live probe, not by reading this).
-- public.users has NO foreign key to auth.users (it only mirrors it), so deleting
-- an auth user leaves its public.users row behind, still holding the email. Since
-- public.users.email is UNIQUE, the next signup on that address then violates the
-- EMAIL constraint — which `on conflict (id)` does not catch — so this trigger
-- raised and Supabase returned an opaque 500 to the caller.
--
-- It goes from theoretical to routine in Slice D, because D is the first slice
-- that DELETES auth users: revoke a student's login, try to reissue the same
-- username, and account creation fails forever with "Couldn't create the login."
--
-- Any public.users row carrying new.email with a different id is stale BY
-- CONSTRUCTION — auth.users.email is itself unique, so a live auth user with this
-- address would be new.id. Deleting it (which cascades its equally-stale
-- memberships) is therefore sound, and it self-heals rows orphaned before this
-- guard existed. revokeStudentAccount also cleans up explicitly; this is the
-- backstop that makes the invariant true no matter who does the deleting.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.users
   where email = new.email
     and id <> new.id;

  insert into public.users (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'name'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 1. Policy helper functions (SECURITY DEFINER → bypass RLS, avoid recursion)
-- ----------------------------------------------------------------------------
-- Tenant ids the current user belongs to, any role. Used by tenant-isolation
-- SELECT policies. STABLE so the planner can cache it within a statement.
create or replace function public.current_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.memberships m
  where m.user_id = (select auth.uid());
$$;

-- Is the current user staff (owner/admin/tutor — NOT parent/student) of a tenant?
-- Staff get tenant-wide visibility + write access; parents/students do not.
create or replace function public.is_tenant_staff(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'tutor')
  );
$$;

-- Which students.id rows the current user IS (Slice D — doc 26 §2D). The whole
-- student-role authorisation model reduces to this one set: every student policy
-- below is `student_id in (select public.current_student_ids())`.
--
-- Why that is tenant-coherent WITHOUT repeating a tenant predicate (unlike the
-- parent policies, which must carry `sp.tenant_id = <table>.tenant_id`):
--   * students.user_id is UNIQUE globally → one auth user ↔ at most one students
--     row ↔ exactly one tenant. There is no "link table" to forge (that was
--     P0-1's whole problem shape — student_parents is many-to-many, this is 1:1).
--   * the join to memberships demands a `student` membership IN THAT SAME
--     TENANT, so a stray user_id alone grants nothing.
--   * every homework table carries B.5's composite FK
--     (tenant_id, student_id) → students(tenant_id, id), so a row naming my
--     student_id is PROVABLY in my student's tenant — the DB cannot represent
--     otherwise.
-- Net: "this row is mine" already implies "this row is in my tenant".
create or replace function public.current_student_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.students s
  join public.memberships m
    on m.user_id = s.user_id
   and m.tenant_id = s.tenant_id
   and m.role = 'student'
  where s.user_id = (select auth.uid())
    and s.active;
$$;

-- Cast a path segment to uuid, or NULL if it isn't one. The storage policies
-- match `(storage.foldername(name))[2]` against student ids, and a bare `::uuid`
-- on a non-uuid segment raises — which would fail the WHOLE query (including
-- staff's), not just skip the row. Legacy Slice-C objects are
-- `${tenant}/${submissionId}/…` (segment 2 IS a uuid, just never a student id),
-- but a stray/hand-uploaded key must degrade to "no match", never to an error.
create or replace function public.safe_uuid(p_text text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then p_text::uuid
    else null
  end;
$$;

revoke all on function public.current_tenant_ids() from public;
revoke all on function public.is_tenant_staff(uuid) from public;
revoke all on function public.current_student_ids() from public;
revoke all on function public.safe_uuid(text) from public;
grant execute on function public.current_tenant_ids() to authenticated;
grant execute on function public.is_tenant_staff(uuid) to authenticated;
grant execute on function public.current_student_ids() to authenticated;
grant execute on function public.safe_uuid(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Enable RLS (idempotent — auto-RLS trigger already set it Day 1/2)
-- ----------------------------------------------------------------------------
alter table public.tenants                     enable row level security;
alter table public.users                       enable row level security;
alter table public.memberships                 enable row level security;
alter table public.students                    enable row level security;
alter table public.student_parents             enable row level security;
alter table public.corpus_sources             enable row level security;
alter table public.tenant_corpus_subscriptions enable row level security;

-- ----------------------------------------------------------------------------
-- 3. Table grants to `authenticated` (PostgREST won't serve a table without
--    a grant; RLS then filters which rows come back). anon stays locked out.
-- ----------------------------------------------------------------------------
-- tenants: COLUMN-LEVEL grant (Slice D — doc 35b §5.1). `tenants_select_member`
-- lets any member of the tenant read the row, and the row contains
-- `voice_signature` — the pedagogy style guide, i.e. the moat, and the prompt we
-- write parent notes and homework feedback with. RLS is ROW-level, and staff /
-- parents / students all share the `authenticated` role, so no policy can hide a
-- column from one of them. The moment a `student` membership exists, a child's
-- account could `select voice_signature from tenants`. (Parents could already.)
--
-- Fixed at the strongest available layer: a column privilege. `authenticated`
-- is simply not granted the column, so NOTHING on the PostgREST path can select
-- it — no view to leak through, no policy to get wrong later, and it fails for
-- staff too rather than pretending. Voice reads/writes moved to the Drizzle
-- server path (lib/voice.server.ts), which connects as the Postgres role and
-- filters tenant_id in code (doc 06 §3) — the same shape as the report drafter.
--
-- Re-granting `select` on the whole table anywhere below would silently undo
-- this. The column list is deliberate; add new tenant columns to it explicitly.
revoke select, update on public.tenants from authenticated;
grant select (id, slug, display_name, brand_color, created_at)
                                     on public.tenants                     to authenticated;
grant update (slug, display_name, brand_color)
                                     on public.tenants                     to authenticated;
grant select, update                 on public.users                       to authenticated;
grant select                         on public.memberships                 to authenticated;
grant select, insert, update, delete on public.students                    to authenticated;
grant select, insert, update, delete on public.student_parents             to authenticated;
grant select                         on public.corpus_sources             to authenticated;
grant select, insert, delete         on public.tenant_corpus_subscriptions to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Policies — tenants
-- ----------------------------------------------------------------------------
-- A member of any role can see the tenants they belong to. Tenant mutations
-- (rename, brand colour) go via service role in Phase 0.
drop policy if exists tenants_select_member on public.tenants;
create policy tenants_select_member on public.tenants
  for select to authenticated
  using (id in (select public.current_tenant_ids()));

-- Staff (owner/admin/tutor) can update their own tenant (voice signature, brand).
drop policy if exists tenants_update_staff on public.tenants;
create policy tenants_update_staff on public.tenants
  for update to authenticated
  using (public.is_tenant_staff(id))
  with check (public.is_tenant_staff(id));

-- ----------------------------------------------------------------------------
-- 5. Policies — users (global identity; visibility derived via memberships)
-- ----------------------------------------------------------------------------
-- See your own row, plus any user who shares a tenant where YOU are staff
-- (so a tutor can read their students'/parents' names).
drop policy if exists users_select_self_or_staff on public.users;
create policy users_select_self_or_staff on public.users
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.memberships m
      where m.user_id = public.users.id
        and public.is_tenant_staff(m.tenant_id)
    )
  );

-- Update only your own profile row.
drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 6. Policies — memberships
-- ----------------------------------------------------------------------------
-- See your own memberships (needed for the tenant-selector), and staff see all
-- memberships in their tenant. Invites/role changes are service-role in Phase 0.
drop policy if exists memberships_select_self_or_staff on public.memberships;
create policy memberships_select_self_or_staff on public.memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_tenant_staff(tenant_id)
  );

-- ----------------------------------------------------------------------------
-- 7. Policies — students (staff tenant-wide; parents only their own children)
-- ----------------------------------------------------------------------------
-- Parent predicates everywhere carry `sp.tenant_id = <table>.tenant_id`
-- (Slice B.5 / Fable P0-1): a parent link only grants reads INSIDE the link's
-- own tenant, so a forged/cross-tenant link row can never widen visibility.
-- Slice D adds the third arm: a student reads their OWN row (their name + year
-- level — the portal greets them by name). current_student_ids() reads this very
-- table, which is safe for the same reason is_tenant_staff() may read
-- memberships from memberships' own policy: SECURITY DEFINER runs as the owner,
-- and an owner bypasses RLS, so there is no recursion. Using the helper (rather
-- than a bare `user_id = auth.uid()`) keeps ONE definition of "is a student" —
-- so a deactivated student, or a lingering user_id with no `student` membership,
-- is locked out here exactly as it is everywhere else.
drop policy if exists students_select_staff_or_parent on public.students;
create policy students_select_staff_or_parent on public.students
  for select to authenticated
  using (
    public.is_tenant_staff(tenant_id)
    or id in (select public.current_student_ids())
    or exists (
      select 1
      from public.student_parents sp
      where sp.student_id = public.students.id
        and sp.tenant_id = public.students.tenant_id
        and sp.parent_user_id = (select auth.uid())
    )
  );

drop policy if exists students_insert_staff on public.students;
create policy students_insert_staff on public.students
  for insert to authenticated
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists students_update_staff on public.students;
create policy students_update_staff on public.students
  for update to authenticated
  using (public.is_tenant_staff(tenant_id))
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists students_delete_staff on public.students;
create policy students_delete_staff on public.students
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- ----------------------------------------------------------------------------
-- 8. Policies — student_parents (staff tenant-wide; parents see their own links)
-- ----------------------------------------------------------------------------
drop policy if exists student_parents_select_staff_or_self on public.student_parents;
create policy student_parents_select_staff_or_self on public.student_parents
  for select to authenticated
  using (
    public.is_tenant_staff(tenant_id)
    or parent_user_id = (select auth.uid())
  );

-- Insert: staff of the row's tenant, AND the student must belong to that same
-- tenant (Fable P0-1 — otherwise staff of tenant B could link themselves to a
-- tenant-A student). The composite FK enforces this too; both layers on purpose.
drop policy if exists student_parents_insert_staff on public.student_parents;
create policy student_parents_insert_staff on public.student_parents
  for insert to authenticated
  with check (
    public.is_tenant_staff(tenant_id)
    and exists (
      select 1
      from public.students s
      where s.id = student_parents.student_id
        and s.tenant_id = student_parents.tenant_id
    )
  );

drop policy if exists student_parents_update_staff on public.student_parents;
create policy student_parents_update_staff on public.student_parents
  for update to authenticated
  using (public.is_tenant_staff(tenant_id))
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists student_parents_delete_staff on public.student_parents;
create policy student_parents_delete_staff on public.student_parents
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- ----------------------------------------------------------------------------
-- 9. Policies — corpus_sources (THE baseline carve-out)
-- ----------------------------------------------------------------------------
-- platform_baseline rows: readable by EVERY authenticated user, no tenant
-- filter (shared open-licensed curriculum). tenant_uploaded rows: standard
-- tenant isolation. All writes are service-role in Phase 0 (platform ingestion
-- + tenant upload pipeline land later).
drop policy if exists corpus_sources_select_baseline_or_tenant on public.corpus_sources;
create policy corpus_sources_select_baseline_or_tenant on public.corpus_sources
  for select to authenticated
  using (
    kind = 'platform_baseline'
    or (kind = 'tenant_uploaded' and tenant_id in (select public.current_tenant_ids()))
  );

-- ----------------------------------------------------------------------------
-- 10. Policies — tenant_corpus_subscriptions (which baseline corpora a tenant enabled)
-- ----------------------------------------------------------------------------
drop policy if exists tenant_corpus_sub_select_member on public.tenant_corpus_subscriptions;
create policy tenant_corpus_sub_select_member on public.tenant_corpus_subscriptions
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

-- Staff manage their tenant's subscriptions (onboarding wizard, Phase 1).
drop policy if exists tenant_corpus_sub_insert_staff on public.tenant_corpus_subscriptions;
create policy tenant_corpus_sub_insert_staff on public.tenant_corpus_subscriptions
  for insert to authenticated
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists tenant_corpus_sub_delete_staff on public.tenant_corpus_subscriptions;
create policy tenant_corpus_sub_delete_staff on public.tenant_corpus_subscriptions
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- ----------------------------------------------------------------------------
-- 10b. Enrollment substrate — subjects, price_list_items, enrollments
--      (Slice A — doc 27). Replaces rate_cards. Staff write tenant-wide; any
--      tenant member reads subjects + the price catalog; a parent reads their
--      own child's enrollments for context (student role: none yet).
-- ----------------------------------------------------------------------------
alter table public.subjects          enable row level security;
alter table public.price_list_items  enable row level security;
alter table public.enrollments       enable row level security;

grant select, insert, update, delete on public.subjects         to authenticated;
grant select, insert, update, delete on public.price_list_items to authenticated;
grant select, insert, update, delete on public.enrollments      to authenticated;

-- subjects: members read their tenant's subjects; staff write.
drop policy if exists subjects_select_member on public.subjects;
create policy subjects_select_member on public.subjects
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists subjects_insert_staff on public.subjects;
create policy subjects_insert_staff on public.subjects
  for insert to authenticated
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists subjects_update_staff on public.subjects;
create policy subjects_update_staff on public.subjects
  for update to authenticated
  using (public.is_tenant_staff(tenant_id))
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists subjects_delete_staff on public.subjects;
create policy subjects_delete_staff on public.subjects
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- price_list_items: STAFF ONLY (Slice D — doc 35b §5.1). This was
-- `..._select_member` on current_tenant_ids(), which meant "any member of the
-- tenant, any role". That was survivable while the only non-staff role was a
-- parent; it is NOT survivable with a `student` membership, because doc 26 §2D
-- locks students out of billing — "NEVER billing" — and the price catalog IS
-- the billing model (every year × subject × mode → hourly rate).
--
-- Staff-only rather than staff-or-parent because no parent surface reads this:
-- a parent's balance comes from parent_lessons.amount_cents (the posted fee),
-- never from the catalog. The two readers are /dashboard/pricing (staff-only
-- page) and resolveEnrollmentPrice in actions/enrollments.ts (requireStaff).
drop policy if exists price_list_items_select_member on public.price_list_items;
drop policy if exists price_list_items_select_staff on public.price_list_items;
create policy price_list_items_select_staff on public.price_list_items
  for select to authenticated
  using (public.is_tenant_staff(tenant_id));

drop policy if exists price_list_items_insert_staff on public.price_list_items;
create policy price_list_items_insert_staff on public.price_list_items
  for insert to authenticated
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists price_list_items_update_staff on public.price_list_items;
create policy price_list_items_update_staff on public.price_list_items
  for update to authenticated
  using (public.is_tenant_staff(tenant_id))
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists price_list_items_delete_staff on public.price_list_items;
create policy price_list_items_delete_staff on public.price_list_items
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- enrollments: staff manage tenant-wide; a parent may READ (only) their own
-- child's enrollments — the "what subjects is my kid on" context. No parent
-- writes; no student access yet (Slice D adds the student role).
drop policy if exists enrollments_select_staff_or_parent on public.enrollments;
create policy enrollments_select_staff_or_parent on public.enrollments
  for select to authenticated
  using (
    public.is_tenant_staff(tenant_id)
    or exists (
      select 1
      from public.student_parents sp
      where sp.student_id = public.enrollments.student_id
        and sp.tenant_id = public.enrollments.tenant_id
        and sp.parent_user_id = (select auth.uid())
    )
  );

drop policy if exists enrollments_insert_staff on public.enrollments;
create policy enrollments_insert_staff on public.enrollments
  for insert to authenticated
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists enrollments_update_staff on public.enrollments;
create policy enrollments_update_staff on public.enrollments
  for update to authenticated
  using (public.is_tenant_staff(tenant_id))
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists enrollments_delete_staff on public.enrollments;
create policy enrollments_delete_staff on public.enrollments
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- ----------------------------------------------------------------------------
-- 10c. enrollment_schedules (weekly recurrence — Slice B, doc 26 §2B)
--      Recurrence lives here; the calendar renders virtual occurrences from these
--      rows and persists a lesson only on touch. Staff manage tenant-wide; a
--      parent may READ (only) their own child's slots for context ("what days is
--      my kid on"). No parent writes; student role arrives in Slice D.
-- ----------------------------------------------------------------------------
alter table public.enrollment_schedules enable row level security;

grant select, insert, update, delete on public.enrollment_schedules to authenticated;

drop policy if exists enrollment_schedules_select_staff_or_parent on public.enrollment_schedules;
create policy enrollment_schedules_select_staff_or_parent on public.enrollment_schedules
  for select to authenticated
  using (
    public.is_tenant_staff(tenant_id)
    or exists (
      select 1
      from public.enrollments e
      join public.student_parents sp
        on sp.student_id = e.student_id
       and sp.tenant_id = e.tenant_id
      where e.id = public.enrollment_schedules.enrollment_id
        and e.tenant_id = public.enrollment_schedules.tenant_id
        and sp.parent_user_id = (select auth.uid())
    )
  );

drop policy if exists enrollment_schedules_insert_staff on public.enrollment_schedules;
create policy enrollment_schedules_insert_staff on public.enrollment_schedules
  for insert to authenticated
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists enrollment_schedules_update_staff on public.enrollment_schedules;
create policy enrollment_schedules_update_staff on public.enrollment_schedules
  for update to authenticated
  using (public.is_tenant_staff(tenant_id))
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists enrollment_schedules_delete_staff on public.enrollment_schedules;
create policy enrollment_schedules_delete_staff on public.enrollment_schedules
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- ----------------------------------------------------------------------------
-- 11. lessons (attendance/billing wedge — now enrollment-scoped)
-- ----------------------------------------------------------------------------
alter table public.lessons enable row level security;

grant select, insert, update, delete on public.lessons to authenticated;

-- lessons: STAFF ONLY on the base table (Slice B.5 / Fable §1 P1). The row-level
-- parent policy used to serve whole rows, which exposed `note` — doc 20 §7.6
-- says the "what we covered" capture stays internal, never shown to parents.
-- Parents read their attendance + fee feed via the column-safe
-- public.parent_lessons view (§11f below).
drop policy if exists lessons_select_staff_or_parent on public.lessons;
create policy lessons_select_staff_or_parent on public.lessons
  for select to authenticated
  using (public.is_tenant_staff(tenant_id));

drop policy if exists lessons_insert_staff on public.lessons;
create policy lessons_insert_staff on public.lessons
  for insert to authenticated
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists lessons_update_staff on public.lessons;
create policy lessons_update_staff on public.lessons
  for update to authenticated
  using (public.is_tenant_staff(tenant_id))
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists lessons_delete_staff on public.lessons;
create policy lessons_delete_staff on public.lessons
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- ----------------------------------------------------------------------------
-- 11b. payments (money received against fees)
-- ----------------------------------------------------------------------------
alter table public.payments enable row level security;
grant select, insert, update, delete on public.payments to authenticated;

-- Staff manage tenant-wide; a parent may read their own child's payments.
drop policy if exists payments_select_staff_or_parent on public.payments;
create policy payments_select_staff_or_parent on public.payments
  for select to authenticated
  using (
    public.is_tenant_staff(tenant_id)
    or exists (
      select 1
      from public.student_parents sp
      where sp.student_id = public.payments.student_id
        and sp.tenant_id = public.payments.tenant_id
        and sp.parent_user_id = (select auth.uid())
    )
  );

drop policy if exists payments_insert_staff on public.payments;
create policy payments_insert_staff on public.payments
  for insert to authenticated
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists payments_update_staff on public.payments;
create policy payments_update_staff on public.payments
  for update to authenticated
  using (public.is_tenant_staff(tenant_id))
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists payments_delete_staff on public.payments;
create policy payments_delete_staff on public.payments
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- ----------------------------------------------------------------------------
-- 11c. reports (parent heartbeat — weekly progress notes)
-- ----------------------------------------------------------------------------
-- Lifecycle draft -> approved -> sent. The trust rule (20_Product_UX_and_Moat.md
-- §7.3): a parent may ONLY ever see a SENT note. Drafts AND internally-approved
-- (reviewed but not yet delivered) notes stay tutor-only — "approve" is the
-- tutor's sign-off, "send" is the deliberate hand-off to the parent. Enforced
-- here, not just in the UI: a parent querying the table directly cannot read a
-- draft or an approved-unsent note. Bulk drafting runs via Drizzle (service
-- path, bypasses RLS, filters tenant_id in code); approve/edit/send run on the
-- supabase-js staff path and exercise the write policies below.
alter table public.reports enable row level security;

grant select, insert, update, delete on public.reports to authenticated;

drop policy if exists reports_select_staff_or_parent on public.reports;
create policy reports_select_staff_or_parent on public.reports
  for select to authenticated
  using (
    public.is_tenant_staff(tenant_id)
    or (
      status = 'sent'
      and exists (
        select 1
        from public.student_parents sp
        where sp.student_id = public.reports.student_id
          and sp.tenant_id = public.reports.tenant_id
          and sp.parent_user_id = (select auth.uid())
      )
    )
  );

drop policy if exists reports_insert_staff on public.reports;
create policy reports_insert_staff on public.reports
  for insert to authenticated
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists reports_update_staff on public.reports;
create policy reports_update_staff on public.reports
  for update to authenticated
  using (public.is_tenant_staff(tenant_id))
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists reports_delete_staff on public.reports;
create policy reports_delete_staff on public.reports
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- ----------------------------------------------------------------------------
-- 11d. Homework & AI correction (Slice C — doc 26 §2C) + the STUDENT role
--      (Slice D — doc 26 §2D): worksheets, assignments, submissions, corrections.
--
--      This is where the locked three-way split (§2D) actually lives. Read it as
--      one table of who-sees-what rather than four separate policies:
--
--        table        staff            student                  parent
--        ----------   --------------   ----------------------   -------------------
--        worksheets   all (library)    only ones ASSIGNED       none
--        assignments  all              own queue (the inbox)    own child's, read-only
--        submissions  all + write      own + INSERT own work    own child's, read-only
--        corrections  all incl. draft  own, RELEASED only,      voiced_note only,
--                                      incl. items + stats      released only, via
--                                                               parent_corrections
--
--      Three invariants hold across every row above:
--        1. release-gating — nothing AI-drafted reaches a student or a parent
--           until Fatima releases it (the same spine as reports' `sent`);
--        2. grades are for staff + the student, never the parent (warmth thesis);
--        3. billing is for staff alone — students appear in NO policy on
--           lessons / payments / enrollments / price_list_items / reports, which
--           is what makes "NEVER billing" a DB fact rather than a UI convention.
-- ----------------------------------------------------------------------------
alter table public.worksheets   enable row level security;
alter table public.assignments  enable row level security;
alter table public.submissions  enable row level security;
alter table public.corrections  enable row level security;

grant select, insert, update, delete on public.worksheets   to authenticated;
grant select, insert, update, delete on public.assignments  to authenticated;
grant select, insert, update, delete on public.submissions  to authenticated;
grant select, insert, update, delete on public.corrections  to authenticated;

-- worksheets: staff read the whole library; a STUDENT reads ONLY a worksheet
-- that is actually assigned to them (Slice D — doc 26 §2D "worksheets ONLY for
-- worksheets assigned to them"). The library is the tenant's private curation —
-- browsing it would leak what every other student is being set, and the order
-- she's planning. `archived` assignments don't grant access (the work was
-- withdrawn). Note the join is gated by current_student_ids(), so the
-- assignment's tenant is provably the student's tenant (composite FK).
drop policy if exists worksheets_select_staff on public.worksheets;
drop policy if exists worksheets_select_staff_or_assigned on public.worksheets;
create policy worksheets_select_staff_or_assigned on public.worksheets
  for select to authenticated
  using (
    public.is_tenant_staff(tenant_id)
    or exists (
      select 1
      from public.assignments a
      where a.worksheet_id = public.worksheets.id
        and a.tenant_id = public.worksheets.tenant_id
        and a.status <> 'archived'
        and a.student_id in (select public.current_student_ids())
    )
  );

drop policy if exists worksheets_insert_staff on public.worksheets;
create policy worksheets_insert_staff on public.worksheets
  for insert to authenticated
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists worksheets_update_staff on public.worksheets;
create policy worksheets_update_staff on public.worksheets
  for update to authenticated
  using (public.is_tenant_staff(tenant_id))
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists worksheets_delete_staff on public.worksheets;
create policy worksheets_delete_staff on public.worksheets
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- assignments: staff full write; a parent reads their own child's queue; a
-- STUDENT reads their own queue — this is the portal inbox (Slice D).
drop policy if exists assignments_select_staff_or_parent on public.assignments;
create policy assignments_select_staff_or_parent on public.assignments
  for select to authenticated
  using (
    public.is_tenant_staff(tenant_id)
    or student_id in (select public.current_student_ids())
    or exists (
      select 1
      from public.student_parents sp
      where sp.student_id = public.assignments.student_id
        and sp.tenant_id = public.assignments.tenant_id
        and sp.parent_user_id = (select auth.uid())
    )
  );

drop policy if exists assignments_insert_staff on public.assignments;
create policy assignments_insert_staff on public.assignments
  for insert to authenticated
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists assignments_update_staff on public.assignments;
create policy assignments_update_staff on public.assignments
  for update to authenticated
  using (public.is_tenant_staff(tenant_id))
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists assignments_delete_staff on public.assignments;
create policy assignments_delete_staff on public.assignments
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- submissions: staff full write; a parent reads their own child's submissions;
-- a STUDENT reads their own.
drop policy if exists submissions_select_staff_or_parent on public.submissions;
create policy submissions_select_staff_or_parent on public.submissions
  for select to authenticated
  using (
    public.is_tenant_staff(tenant_id)
    or student_id in (select public.current_student_ids())
    or exists (
      select 1
      from public.student_parents sp
      where sp.student_id = public.submissions.student_id
        and sp.tenant_id = public.submissions.tenant_id
        and sp.parent_user_id = (select auth.uid())
    )
  );

drop policy if exists submissions_insert_staff on public.submissions;
create policy submissions_insert_staff on public.submissions
  for insert to authenticated
  with check (public.is_tenant_staff(tenant_id));

-- THE student write path — the only INSERT a student may perform anywhere in the
-- schema (doc 26 §2D: "uploads come from the student account"; a parent may
-- operate it for a young child, which is why there is no parent-upload UI and no
-- parent INSERT policy). C cut this seam already: uploader_role is polymorphic,
-- so D fills in the 'student' arm rather than reworking C.
--
-- The with-check pins all three of who/as-what/for-whom, so a student's own JWT
-- cannot forge a submission for another student or launder one in as the tutor's:
--   * student_id ∈ current_student_ids()  → only for themselves;
--   * uploader_role = 'student'           → can't impersonate a tutor upload
--                                           (which is what the correction
--                                           workstation trusts as gatekept);
--   * uploaded_by = auth.uid()            → the record names the real account.
-- tenant_id needs no predicate here: the composite FK (tenant_id, student_id) →
-- students(tenant_id, id) makes a mismatched tenant unrepresentable (B.5 P0-1).
drop policy if exists submissions_insert_student on public.submissions;
create policy submissions_insert_student on public.submissions
  for insert to authenticated
  with check (
    student_id in (select public.current_student_ids())
    and uploader_role = 'student'
    and uploaded_by = (select auth.uid())
  );

-- A student may take back work they just handed in, but ONLY while it is
-- untouched — once a correction row exists, the tutor has begun (or finished)
-- marking it, and deleting it out from under her would erase her work and, if
-- released, rewrite the record. This is what backs the portal's toast-with-undo
-- on upload (holding the UX bar); staff keep the unconditional discard.
drop policy if exists submissions_delete_student on public.submissions;
create policy submissions_delete_student on public.submissions
  for delete to authenticated
  using (
    student_id in (select public.current_student_ids())
    and uploader_role = 'student'
    and not exists (
      select 1
      from public.corrections c
      where c.submission_id = public.submissions.id
    )
  );

drop policy if exists submissions_update_staff on public.submissions;
create policy submissions_update_staff on public.submissions
  for update to authenticated
  using (public.is_tenant_staff(tenant_id))
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists submissions_delete_staff on public.submissions;
create policy submissions_delete_staff on public.submissions
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- corrections: staff, plus the STUDENT the work belongs to — but only once it is
-- RELEASED. Not parents: the old released-row parent policy served whole rows,
-- and `items` (per-question verdicts) + `stats` (the tally) are GRADES, which
-- doc 26 §2D keeps from parents (they read voiced_note via the column-safe
-- public.parent_corrections view, §11f).
--
-- This is the three-way split at its sharpest, on one table:
--   staff   → everything, draft included (she IS the author);
--   student → their own, released only, INCLUDING items + stats — "score stays
--             tutor-side AND student-side" (§2D). The student is the one person
--             who should see their own marks; withholding them would make the
--             portal pointless.
--   parent  → voiced_note only, released only, via the view. Never a grade —
--             "never broadcast low performance to parents" (the warmth thesis).
-- The `released` gate is the same trust spine as reports' `sent`: an AI draft
-- Fatima hasn't reviewed must not reach a child either. Enforced here at the DB,
-- so a student hitting PostgREST directly gets nothing.
drop policy if exists corrections_select_staff_or_parent on public.corrections;
drop policy if exists corrections_select_staff_or_student on public.corrections;
create policy corrections_select_staff_or_student on public.corrections
  for select to authenticated
  using (
    public.is_tenant_staff(tenant_id)
    or (
      status = 'released'
      and student_id in (select public.current_student_ids())
    )
  );

drop policy if exists corrections_insert_staff on public.corrections;
create policy corrections_insert_staff on public.corrections
  for insert to authenticated
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists corrections_update_staff on public.corrections;
create policy corrections_update_staff on public.corrections
  for update to authenticated
  using (public.is_tenant_staff(tenant_id))
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists corrections_delete_staff on public.corrections;
create policy corrections_delete_staff on public.corrections
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- ----------------------------------------------------------------------------
-- 11f. PARENT-SAFE VIEWS (Slice B.5 / Fable §1 P1 — "enforced in RLS, not just
--      the UI", at COLUMN granularity).
--      RLS is row-level; PostgREST serves whole rows. Since staff and parents
--      share the `authenticated` role, column safety comes from definer-style
--      views: the view owner (postgres) bypasses the base tables' RLS, and the
--      WHERE clause bakes in the parent predicate (tenant-coherent, per P0-1).
--      security_barrier stops leaky-function pushdown. Base tables stay
--      staff-only for SELECT (§11 / §11d above).
--
--        parent_lessons     : the attendance + fee feed. NO `note` (doc 20
--                             §7.6 — "what we covered" stays internal), no
--                             fee_override (billing internals).
--        parent_corrections : released feedback only. NO `items`, NO `stats`
--                             (doc 26 §2D — feedback, never grades).
--
-- ⚠️ READ BEFORE "FIXING" THE SUPABASE SECURITY ADVISOR ⚠️
--    Supabase's advisor flags both views as CRITICAL "Security Definer View".
--    That finding is the REMEDIATION for doc 35b's P1 (parents could read
--    lessons.note and corrections.items/stats), not a vulnerability. Fable's
--    review recommended exactly this: "Views are the practical option since
--    staff and parents share the `authenticated` role."
--
--    DO NOT set `security_invoker = true` to clear the warning. The base
--    tables are staff-only for SELECT (§11 / §11d), so with invoker semantics
--    a parent gets ZERO rows — win-cards, balances and student-detail history
--    all go blank, and it reads like a data bug, not a security change.
--
--    Verified safe by live production probes with real parent JWTs at Slice
--    B.5 (24/24, doc 35e): scoping exact per parent, forbidden columns absent.
--    Safety rests on the WHERE clause below — auth.uid() still resolves to the
--    CALLER even though the view runs as owner. There is no RLS policy
--    underneath as a backstop, so treat these two definitions as
--    security-critical: never widen the column list or weaken the predicate
--    without re-review. `pnpm db:policies` asserts the forbidden columns stay
--    out (apply-policies.ts).
-- ----------------------------------------------------------------------------
drop view if exists public.parent_lessons;
create view public.parent_lessons
  with (security_barrier)
  as
  select
    l.id,
    l.tenant_id,
    l.student_id,
    l.enrollment_id,
    l.date,
    l.starts_at,
    l.status,
    l.origin,
    l.duration_minutes,
    l.amount_cents
  from public.lessons l
  where exists (
    select 1
    from public.student_parents sp
    where sp.student_id = l.student_id
      and sp.tenant_id = l.tenant_id
      and sp.parent_user_id = (select auth.uid())
  );

drop view if exists public.parent_corrections;
create view public.parent_corrections
  with (security_barrier)
  as
  select
    c.id,
    c.tenant_id,
    c.submission_id,
    c.student_id,
    c.voiced_note,
    c.released_at
  from public.corrections c
  where c.status = 'released'
    and exists (
      select 1
      from public.student_parents sp
      where sp.student_id = c.student_id
        and sp.tenant_id = c.tenant_id
        and sp.parent_user_id = (select auth.uid())
    );

revoke all on public.parent_lessons from public, anon;
revoke all on public.parent_corrections from public, anon;
grant select on public.parent_lessons to authenticated;
grant select on public.parent_corrections to authenticated;

-- ----------------------------------------------------------------------------
-- 11g. RESCHEDULE RPCs (Slice B.5 / Fable §2 P1 — re-entrancy + atomicity).
--      strike + makeup + link were three separate PostgREST writes; a failure
--      mid-way left a struck original with no makeup, and a double-tap created
--      a second makeup (nets TWO billed sessions — breaks doc 26 §2B).
--      One SECURITY INVOKER function = one transaction; RLS still applies to
--      every statement inside (staff-only writes), so this adds no privilege.
--      Guards: the original must be status='scheduled' AND not already linked;
--      undo refuses to delete a makeup that has been marked.
-- ----------------------------------------------------------------------------
create or replace function public.reschedule_occurrence(
  p_lesson_id uuid, -- null = the original is still virtual
  p_enrollment_id uuid,
  p_date date,
  p_starts_at timestamptz,
  p_duration_minutes int,
  p_new_date date,
  p_new_starts_at timestamptz
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_enr record;
  v_original public.lessons%rowtype;
  v_original_id uuid;
  v_was_virtual boolean := false;
  v_prev_status public.lesson_status := 'scheduled';
  v_prev_amount int := 0;
  v_makeup_id uuid;
begin
  select tenant_id, student_id
    into v_enr
    from public.enrollments
   where id = p_enrollment_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Enrollment not found.');
  end if;

  if p_lesson_id is not null then
    select * into v_original
      from public.lessons
     where id = p_lesson_id
       for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'Lesson not found.');
    end if;
    -- Re-entrancy guard: only an unresolved, unlinked original can be struck.
    if v_original.status <> 'scheduled'
       or v_original.rescheduled_to_lesson_id is not null then
      return jsonb_build_object(
        'ok', false,
        'error', 'This class was already marked or rescheduled. Refresh to see its current state.'
      );
    end if;
    v_original_id := p_lesson_id;
    v_prev_status := v_original.status;
    v_prev_amount := v_original.amount_cents;
  else
    -- Materialise the virtual original. The partial unique occurrence index
    -- makes a concurrent touch a unique_violation → caught below, nothing
    -- half-done.
    v_was_virtual := true;
    insert into public.lessons
      (tenant_id, student_id, enrollment_id, date, starts_at,
       status, origin, duration_minutes, amount_cents)
    values
      (v_enr.tenant_id, v_enr.student_id, p_enrollment_id, p_date, p_starts_at,
       'scheduled', 'recurring', p_duration_minutes, 0)
    returning id into v_original_id;
  end if;

  insert into public.lessons
    (tenant_id, student_id, enrollment_id, date, starts_at,
     status, origin, duration_minutes, amount_cents)
  values
    (v_enr.tenant_id, v_enr.student_id, p_enrollment_id, p_new_date, p_new_starts_at,
     'scheduled', 'makeup', p_duration_minutes, 0)
  returning id into v_makeup_id;

  update public.lessons
     set status = 'rescheduled',
         amount_cents = 0,
         rescheduled_to_lesson_id = v_makeup_id
   where id = v_original_id;

  return jsonb_build_object(
    'ok', true,
    'original_id', v_original_id,
    'original_was_virtual', v_was_virtual,
    'makeup_id', v_makeup_id,
    'prev_status', v_prev_status,
    'prev_amount', v_prev_amount
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'ok', false,
      'error', 'That occurrence was just changed somewhere else. Refresh and try again.'
    );
end;
$$;

create or replace function public.undo_reschedule(
  p_original_id uuid,
  p_makeup_id uuid,
  p_original_was_virtual boolean,
  p_prev_status public.lesson_status,
  p_prev_amount int
)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  -- Refuse if the makeup was already resolved — deleting it would erase a
  -- billed (or otherwise decided) row.
  perform 1 from public.lessons
    where id = p_makeup_id and status = 'scheduled'
    for update;
  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'The makeup was already marked — undo that mark first.'
    );
  end if;

  delete from public.lessons where id = p_makeup_id;

  if p_original_was_virtual then
    delete from public.lessons where id = p_original_id;
  else
    update public.lessons
       set status = p_prev_status,
           amount_cents = p_prev_amount,
           rescheduled_to_lesson_id = null
     where id = p_original_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.reschedule_occurrence(uuid, uuid, date, timestamptz, int, date, timestamptz) from public, anon;
revoke all on function public.undo_reschedule(uuid, uuid, boolean, public.lesson_status, int) from public, anon;
grant execute on function public.reschedule_occurrence(uuid, uuid, date, timestamptz, int, date, timestamptz) to authenticated;
grant execute on function public.undo_reschedule(uuid, uuid, boolean, public.lesson_status, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 11e. Supabase Storage — private buckets for worksheet + submission files.
--      Path convention: segment 1 is ALWAYS the tenant uuid, so a single
--      predicate scopes every object to its tenant's staff. Slice D adds a
--      second segment to submissions — `${tenantId}/${studentId}/…` — so a
--      student's own work is expressible as a path predicate too (doc 35b §5.4).
--      Uploads/reads happen on the supabase-js path (RLS-enforced); the app
--      hands out short-lived signed URLs, never public links.
--      A PARENT still gets no object access at all: they read the released
--      voiced_note, never the scanned page of their child's work.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('worksheets', 'worksheets', false), ('submissions', 'submissions', false)
on conflict (id) do nothing;

-- Staff of the tenant named by the first path segment get full object access.
drop policy if exists homework_objects_staff_all on storage.objects;
create policy homework_objects_staff_all on storage.objects
  for all to authenticated
  using (
    bucket_id in ('worksheets', 'submissions')
    and public.is_tenant_staff(public.safe_uuid((storage.foldername(name))[1]))
  )
  with check (
    bucket_id in ('worksheets', 'submissions')
    and public.is_tenant_staff(public.safe_uuid((storage.foldername(name))[1]))
  );

-- SUBMISSIONS, student side (Slice D — doc 35b §5.4). The single `${tenantId}`
-- staff predicate can't express "this student's own work", so the submissions
-- convention gains a second segment: `${tenantId}/${studentId}/${submissionId}/
-- ${file}`. Segment 2 is the owner, and one predicate scopes reads AND writes.
--
-- Legacy note: Slice-C objects are `${tenantId}/${submissionId}/…`. They keep
-- working — the STAFF policy only reads segment 1, which is unchanged — and this
-- student policy simply never matches them (a submissionId is a uuid, so
-- safe_uuid returns it, but it is not in current_student_ids() → no rows). So
-- there is no path rewrite and no object migration: old objects stay staff-only,
-- new ones are student-reachable. Fatima's real uploads are untouched.
--
-- WORKSHEETS deliberately get NO student storage policy. "Is this worksheet
-- assigned to me?" is a JOIN (assignments → worksheets), not a fact recoverable
-- from an object key, and encoding it in the path would mean copying a file per
-- student. Students receive worksheet bytes only via signedWorksheetUrlForStudent
-- (lib/actions/portal.ts), which checks the assignment first. Per doc 35b §5.4.
drop policy if exists submission_objects_student_read on storage.objects;
create policy submission_objects_student_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'submissions'
    and public.safe_uuid((storage.foldername(name))[2])
        in (select public.current_student_ids())
  );

drop policy if exists submission_objects_student_write on storage.objects;
create policy submission_objects_student_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and public.safe_uuid((storage.foldername(name))[2])
        in (select public.current_student_ids())
  );

-- Deleting their own object backs the upload undo (see submissions_delete_student
-- above). Bounded by the same path predicate: their own folder, nothing else.
drop policy if exists submission_objects_student_delete on storage.objects;
create policy submission_objects_student_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'submissions'
    and public.safe_uuid((storage.foldername(name))[2])
        in (select public.current_student_ids())
  );

-- ----------------------------------------------------------------------------
-- 11h. audit_log + student_login_attempts (Slice D — doc 35b §5.5)
--     The audit log stops being optional the day the tutor holds credentials for
--     other people's children. Both tables are written ONLY from server-side
--     code on the Drizzle path (which connects as the Postgres role and bypasses
--     RLS by design, doc 06 §3) — so neither gets a write grant here.
-- ----------------------------------------------------------------------------
alter table public.audit_log             enable row level security;
alter table public.student_login_attempts enable row level security;

-- Staff may READ their own tenant's trail (so the record is answerable to the
-- person accountable for it). No insert/update/delete grant to `authenticated`
-- at all: append-only isn't a policy here, it's the absence of a privilege —
-- there is no PostgREST path that can rewrite or erase history.
grant select on public.audit_log to authenticated;

drop policy if exists audit_log_select_staff on public.audit_log;
create policy audit_log_select_staff on public.audit_log
  for select to authenticated
  using (public.is_tenant_staff(tenant_id));

-- student_login_attempts gets NO grant of any kind. It is keyed by username and
-- consulted BEFORE anyone is authenticated, so exposing it on the Data API would
-- hand out a username oracle ("which handles exist / are locked") — exactly what
-- the deterministic synthetic-email scheme otherwise avoids. RLS is enabled to
-- satisfy the RLS-on assertion; the lack of a grant is what actually shuts it.
-- (Belt and braces: no grant AND no policy = no rows on that path, ever.)

-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 12. Tell PostgREST to reload its schema cache (so new grants/tables show up
--     on the Data API immediately — Day 1 set "auto-expose new tables: OFF").
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ============================================================================
-- End of policies. Re-run any time the schema or rules change.
-- ============================================================================
