import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * Active-tenant resolution.
 *
 * Reads go through the RLS-enforced supabase-js server client (publishable key),
 * NOT Drizzle — so this is the path that actually exercises the Day 3 policies.
 * A user sees only memberships where user_id = auth.uid(); a parent sees only
 * their own children downstream.
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

export async function getMemberships(): Promise<TenantMembership[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // Filter to the CURRENT user's own memberships. Required because the
  // memberships RLS policy also lets staff (owner/admin/tutor) read every
  // membership in their tenant — without this, an owner would see their tenant
  // once per member (their own row + every parent/student row).
  const { data, error } = await supabase
    .from("memberships")
    .select("role, tenant:tenants(id, slug, display_name, brand_color)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

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
}

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
export async function resolveActiveTenant(): Promise<ActiveTenantResult> {
  const memberships = await getMemberships();
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
}
