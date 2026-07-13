"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import type { BillingCycle } from "@/lib/db/schema";

async function requireStaff() {
  const res = await resolveActiveTenant();
  if (res.status !== "ok") return null;
  if (!["owner", "admin", "tutor"].includes(res.tenant.role)) return null;
  return res.tenant;
}

/**
 * Create a student. Rate is no longer set here — it comes from the price list
 * via enrollments (Slice A). Year level matters now: it's the catalog join key.
 * After adding, staff add one or more enrollments on the student record.
 */
export async function createStudent(input: {
  firstName: string;
  lastName: string;
  yearLevel: string;
  cycle: BillingCycle;
  anchor: string;
}): Promise<{ ok: boolean; studentId: string | null }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, studentId: null };

  const firstName = input.firstName?.trim();
  if (!firstName) return { ok: false, studentId: null };

  const cycle: BillingCycle = (
    ["weekly", "fortnightly", "monthly"] as BillingCycle[]
  ).includes(input.cycle)
    ? input.cycle
    : "monthly";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("students")
    .insert({
      tenant_id: tenant.tenantId,
      first_name: firstName,
      last_name: input.lastName?.trim() || null,
      year_level: input.yearLevel?.trim() || null,
      billing_cycle: cycle,
      billing_anchor: input.anchor || null,
      active: true,
    })
    .select("id")
    .single();

  revalidatePath("/dashboard", "layout");
  return {
    ok: !error,
    studentId: (data as unknown as { id: string } | null)?.id ?? null,
  };
}

/** Archive (active=false) or reactivate a student. History is preserved. */
export async function setStudentActive(
  studentId: string,
  active: boolean,
): Promise<{ ok: boolean }> {
  const tenant = await requireStaff();
  if (!tenant || !studentId) return { ok: false };
  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("students")
    .update({ active })
    .eq("id", studentId)
    .eq("tenant_id", tenant.tenantId)
    .select("id");
  revalidatePath("/dashboard", "layout");
  return { ok: !error && (updated ?? []).length > 0 };
}

/**
 * Permanent delete — cascades enrollments, lessons + payments (the student's
 * entire billing ledger). Mistakes only. Staff-checked in code (not just RLS),
 * scoped to the active tenant, and row-count-verified: an RLS no-op can never
 * report success on a destructive call.
 */
export async function deleteStudent(
  studentId: string,
): Promise<{ ok: boolean }> {
  const tenant = await requireStaff();
  if (!tenant || !studentId) return { ok: false };
  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from("students")
    .delete()
    .eq("id", studentId)
    .eq("tenant_id", tenant.tenantId)
    .select("id");
  revalidatePath("/dashboard", "layout");
  return { ok: !error && (deleted ?? []).length > 0 };
}
