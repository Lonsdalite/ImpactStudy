"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import type { BillingCycle } from "@/lib/db/schema";

const VALID: BillingCycle[] = ["weekly", "fortnightly", "monthly"];

async function requireStaff(): Promise<{ tenantId: string } | null> {
  const res = await resolveActiveTenant();
  if (res.status !== "ok") return null;
  if (!["owner", "admin", "tutor"].includes(res.tenant.role)) return null;
  return { tenantId: res.tenant.tenantId };
}

/**
 * Set a student's year level (the price-catalog join key), billing cycle, and
 * anchor (start) date. The rate now lives on the price list + enrollments, not
 * the student — there's no per-student rate to set here anymore (Slice A).
 * Staff-checked in code (doc 06 §6's second layer), tenant-scoped, row-count
 * verified.
 */
export async function updateBilling(
  studentId: string,
  yearLevel: string,
  cycle: BillingCycle,
  anchor: string,
): Promise<{ ok: boolean }> {
  const staff = await requireStaff();
  if (!staff || !studentId || !VALID.includes(cycle)) return { ok: false };
  const supabase = await createClient();

  const { data: updated, error } = await supabase
    .from("students")
    .update({
      year_level: yearLevel?.trim() || null,
      billing_cycle: cycle,
      billing_anchor: anchor || null,
    })
    .eq("id", studentId)
    .eq("tenant_id", staff.tenantId)
    .select("id");

  revalidatePath("/dashboard", "layout");
  return { ok: !error && (updated ?? []).length > 0 };
}
