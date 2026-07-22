import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { perfLog } from "@/lib/perf";

/**
 * Active-tenant resolution.
 *
 * Reads go through the RLS-enforced supabase-js server client (publishable key),
 * NOT Drizzle — so this is the path that actually exercises the Day 3 policies.
 * A user sees only memberships where user_id = auth.uid(); a parent sees only
 * their own children downstream.
 *
 * Every export here is wrapped in React `cache()` (doc 42). The dashboard layout
 * resolves the tenant and then each PAGE resolved it again, so a single
 * navigation ran the memberships query twice — measured at 2 × ~650ms from the
 * old US-East region, and still two needless round trips after the move to
 * syd1. `cache()` is REQUEST-scoped, not a shared cache: two users, or the same
 * user on two requests, never see each other's result, so this changes cost
 * without touching the tenant-isolation boundary. Nothing here is memoised
 * across requests, and the middleware's own getUser() — the one that actually
 * gates protected routes — is a separate runtime and stays a real validation.
 */

export const ACTIVE_TENANT_COOKIE = "is_active_tenant";

export type TenantMembership = {
  tenantId: string;
  slug: string;
  displayName: string;
  brandColor: string;
  role: string;
};

// Shape of the embedded PostgREST row (no generated DB types yet).
interface MembershipRow {
  role: string;
  tenant: {
    id: string;
    slug: string;
    display_name: string;
    brand_color: string;
  } | null;
}

/**
 * The signed-in user, validated once per request.
 *
 * Still a real `getUser()` — the server-side validation, never `getSession()` —
 * just not repeated by every caller that needs the same answer within one
 * render. The dashboard layout and `getMemberships()` both want it.
 */
export const getSessionUser = cache(async function getSessionUser() {
  const supabase = await createClient();
  const tUser = performance.now();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  perfLog("tenant.getUser", tUser);
  return user;
});

export const getMemberships = cache(async function getMemberships(): Promise<
  TenantMembership[]
> {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await createClient();
  const tRows = performance.now();

  // Filter to the CURRENT user's own memberships. Required because the
  // memberships RLS policy also lets staff (owner/admin/tutor) read every
  // membership in their tenant — without this, an owner would see their tenant
  // once per member (their own row + every parent/student row).
  const { data, error } = await supabase
    .from("memberships")
    .select("role, tenant:tenants(id, slug, display_name, brand_color)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  perfLog("tenant.memberships", tRows);

  if (error) throw error;

  const rows = (data ?? []) as unknown as MembershipRow[];
  return rows
    .filter((r): r is MembershipRow & { tenant: NonNullable<MembershipRow["tenant"]> } => r.tenant !== null)
    .map((r) => ({
      tenantId: r.tenant.id,
      slug: r.tenant.slug,
      displayName: r.tenant.display_name,
      brandColor: r.tenant.brand_color,
      role: r.role,
    }));
});

export type ActiveTenantResult =
  | { status: "ok"; tenant: TenantMembership; memberships: TenantMembership[] }
  | { status: "select"; memberships: TenantMembership[] }
  | { status: "none" };

/**
 * Resolve which tenant the user is acting under:
 * - cookie match  → that tenant
 * - exactly one   → that tenant (no cookie needed)
 * - more than one → caller should send them to /tenant-select
 * - none          → user belongs to no tenant
 */
export const resolveActiveTenant = cache(async function resolveActiveTenant(): Promise<ActiveTenantResult> {
  const t0 = performance.now();
  const memberships = await getMemberships();
  perfLog("tenant.resolve", t0);
  if (memberships.length === 0) return { status: "none" };

  const cookieStore = await cookies();
  const wanted = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
  const matched = wanted
    ? memberships.find((m) => m.tenantId === wanted)
    : undefined;

  if (matched) return { status: "ok", tenant: matched, memberships };
  if (memberships.length === 1)
    return { status: "ok", tenant: memberships[0], memberships };
  return { status: "select", memberships };
});
