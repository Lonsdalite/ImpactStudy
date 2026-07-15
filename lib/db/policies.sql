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
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

revoke all on function public.current_tenant_ids() from public;
revoke all on function public.is_tenant_staff(uuid) from public;
grant execute on function public.current_tenant_ids() to authenticated;
grant execute on function public.is_tenant_staff(uuid) to authenticated;

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
grant select, update                 on public.tenants                     to authenticated;
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
drop policy if exists students_select_staff_or_parent on public.students;
create policy students_select_staff_or_parent on public.students
  for select to authenticated
  using (
    public.is_tenant_staff(tenant_id)
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

-- price_list_items: members read their tenant's catalog; staff write.
drop policy if exists price_list_items_select_member on public.price_list_items;
create policy price_list_items_select_member on public.price_list_items
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

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
-- 11d. Homework & AI correction (Slice C — doc 26 §2C):
--      worksheets, assignments, submissions, corrections.
--      Staff write tenant-wide. A parent is low-touch (§2D): read-only on their
--      own child's assignments + submissions for context, and on a correction
--      ONLY once it's RELEASED (mirrors the reports "sent-only" trust gate).
--      Worksheets are the tenant's private library — staff only. The `student`
--      role stays out until Slice D.
-- ----------------------------------------------------------------------------
alter table public.worksheets   enable row level security;
alter table public.assignments  enable row level security;
alter table public.submissions  enable row level security;
alter table public.corrections  enable row level security;

grant select, insert, update, delete on public.worksheets   to authenticated;
grant select, insert, update, delete on public.assignments  to authenticated;
grant select, insert, update, delete on public.submissions  to authenticated;
grant select, insert, update, delete on public.corrections  to authenticated;

-- worksheets: staff-only (the tenant's private assignable library).
drop policy if exists worksheets_select_staff on public.worksheets;
create policy worksheets_select_staff on public.worksheets
  for select to authenticated
  using (public.is_tenant_staff(tenant_id));

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

-- assignments: staff full write; a parent reads their own child's queue.
drop policy if exists assignments_select_staff_or_parent on public.assignments;
create policy assignments_select_staff_or_parent on public.assignments
  for select to authenticated
  using (
    public.is_tenant_staff(tenant_id)
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

-- submissions: staff full write; a parent reads their own child's submissions.
drop policy if exists submissions_select_staff_or_parent on public.submissions;
create policy submissions_select_staff_or_parent on public.submissions
  for select to authenticated
  using (
    public.is_tenant_staff(tenant_id)
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

drop policy if exists submissions_update_staff on public.submissions;
create policy submissions_update_staff on public.submissions
  for update to authenticated
  using (public.is_tenant_staff(tenant_id))
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists submissions_delete_staff on public.submissions;
create policy submissions_delete_staff on public.submissions
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- corrections: STAFF ONLY on the base table (Slice B.5 / Fable §1 P1). The old
-- released-row parent policy served whole rows — `items` (per-question verdicts)
-- and `stats` (right/wrong tally) are grades, and doc 26 §2D says parents get
-- feedback, NEVER grades. Parents read released feedback via the column-safe
-- public.parent_corrections view (§11f below): voiced_note + released_at only.
drop policy if exists corrections_select_staff_or_parent on public.corrections;
create policy corrections_select_staff_or_parent on public.corrections
  for select to authenticated
  using (public.is_tenant_staff(tenant_id));

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
--      Path convention: `${tenant_id}/${...}` — the FIRST path segment is the
--      tenant uuid, so a single predicate scopes every object to its tenant's
--      staff. Uploads/reads happen on the supabase-js path (RLS-enforced);
--      the app hands out short-lived signed URLs, never public links.
--      Parent/student read of submission IMAGES is deferred to Slice D (in C a
--      parent only sees the released text feedback, not the scanned page).
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
    and public.is_tenant_staff(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id in ('worksheets', 'submissions')
    and public.is_tenant_staff(((storage.foldername(name))[1])::uuid)
  );

-- ----------------------------------------------------------------------------
-- 12. Tell PostgREST to reload its schema cache (so new grants/tables show up
--     on the Data API immediately — Day 1 set "auto-expose new tables: OFF").
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ============================================================================
-- End of policies. Re-run any time the schema or rules change.
-- ============================================================================
