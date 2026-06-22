-- ============================================================================
-- ImpactStudy — RLS policies, identity plumbing, and grants
-- ----------------------------------------------------------------------------
-- Day 3 (Phase 0). Tenant-isolation model per 06_Technical_Architecture.md +
-- baseline-corpus carve-out per 17_Baseline_Curriculum_Corpus.md.
--
-- IDEMPOTENT: safe to re-run. Every object is dropped-if-exists then recreated.
--
-- ⚠️  CRITICAL: `drizzle-kit push` DISABLES RLS on every table (it reconciles the
--     DB to the Drizzle schema, which doesn't declare RLS). So ALWAYS re-run this
--     after a push. `pnpm db:push` is chained to do it automatically; if you ever
--     run `db:push:only` (raw), follow it with `pnpm db:policies`. A parent
--     seeing students who aren't their children = RLS got disabled; re-run this.
--
-- HOW TO APPLY (pick one):
--   1. Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   2. psql "$DIRECT_URL" -f lib/db/policies.sql
--      (DIRECT_URL = session-mode pooler, port 5432 — NOT the 6543 runtime URL.
--       Run db:push FIRST so the corpus tables exist before we policy them.)
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
drop policy if exists students_select_staff_or_parent on public.students;
create policy students_select_staff_or_parent on public.students
  for select to authenticated
  using (
    public.is_tenant_staff(tenant_id)
    or exists (
      select 1
      from public.student_parents sp
      where sp.student_id = public.students.id
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

drop policy if exists student_parents_insert_staff on public.student_parents;
create policy student_parents_insert_staff on public.student_parents
  for insert to authenticated
  with check (public.is_tenant_staff(tenant_id));

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
-- 11. rate_cards + lessons (attendance/billing wedge)
-- ----------------------------------------------------------------------------
alter table public.rate_cards enable row level security;
alter table public.lessons    enable row level security;

grant select, insert, update, delete on public.rate_cards to authenticated;
grant select, insert, update, delete on public.lessons    to authenticated;

-- rate_cards: any tenant member may read; only staff may write.
drop policy if exists rate_cards_select_member on public.rate_cards;
create policy rate_cards_select_member on public.rate_cards
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists rate_cards_insert_staff on public.rate_cards;
create policy rate_cards_insert_staff on public.rate_cards
  for insert to authenticated
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists rate_cards_update_staff on public.rate_cards;
create policy rate_cards_update_staff on public.rate_cards
  for update to authenticated
  using (public.is_tenant_staff(tenant_id))
  with check (public.is_tenant_staff(tenant_id));

drop policy if exists rate_cards_delete_staff on public.rate_cards;
create policy rate_cards_delete_staff on public.rate_cards
  for delete to authenticated
  using (public.is_tenant_staff(tenant_id));

-- lessons: staff see/manage the whole tenant; a parent sees (read-only) the
-- lessons of their own linked children (their attendance + fee feed).
drop policy if exists lessons_select_staff_or_parent on public.lessons;
create policy lessons_select_staff_or_parent on public.lessons
  for select to authenticated
  using (
    public.is_tenant_staff(tenant_id)
    or exists (
      select 1
      from public.student_parents sp
      where sp.student_id = public.lessons.student_id
        and sp.parent_user_id = (select auth.uid())
    )
  );

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
-- 12. Tell PostgREST to reload its schema cache (so new grants/tables show up
--     on the Data API immediately — Day 1 set "auto-expose new tables: OFF").
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ============================================================================
-- End of policies. Re-run any time the schema or rules change.
-- ============================================================================
