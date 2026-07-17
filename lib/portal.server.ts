import "server-only";

import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";

/**
 * "Who is this student?" — the portal's counterpart to requireStaff() (Slice D).
 *
 * Every portal page and action starts here. It resolves the caller's OWN student
 * row from their session; a studentId is never accepted from the client, which
 * removes the entire class of "pass someone else's id" bugs before RLS has to
 * catch them.
 *
 * Mirrors the SQL definition of "is a student" in current_student_ids()
 * (policies.sql §1) — the student row must be active, and the membership must be
 * role='student' in that row's own tenant. Kept deliberately in step: if a
 * student is deactivated or their login revoked, the portal and the database
 * agree they're gone, rather than one of them still saying yes.
 */
export interface PortalStudent {
  studentId: string;
  tenantId: string;
  userId: string;
  firstName: string;
  yearLevel: string | null;
  tenantName: string;
}

export async function requireStudent(): Promise<PortalStudent | null> {
  const res = await resolveActiveTenant();
  if (res.status !== "ok" || res.tenant.role !== "student") return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // students_select_staff_or_parent's student arm (`id in
  // current_student_ids()`) is what makes this readable at all — and it returns
  // AT MOST one row, because students.user_id is globally unique. That
  // uniqueness is the same fact that makes the whole student RLS model
  // tenant-coherent (see policies.sql §1).
  const { data } = await supabase
    .from("students")
    .select("id, tenant_id, first_name, year_level")
    .eq("user_id", user.id)
    .eq("tenant_id", res.tenant.tenantId)
    .eq("active", true)
    .maybeSingle();
  const row = data as unknown as {
    id: string;
    tenant_id: string;
    first_name: string;
    year_level: string | null;
  } | null;
  if (!row) return null;

  return {
    studentId: row.id,
    tenantId: row.tenant_id,
    userId: user.id,
    firstName: row.first_name,
    yearLevel: row.year_level,
    tenantName: res.tenant.displayName,
  };
}
