"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BillingCycle } from "@/lib/db/schema";

const VALID: BillingCycle[] = ["weekly", "fortnightly", "monthly"];

/**
 * Set a student's year level (the price-catalog join key), billing cycle, and
 * anchor (start) date. The rate now lives on the price list + enrollments, not
 * the student — there's no per-student rate to set here anymore (Slice A).
 */
export async function updateBilling(
  studentId: string,
  yearLevel: string,
  cycle: BillingCycle,
  anchor: string,
): Promise<{ ok: boolean }> {
  if (!studentId || !VALID.includes(cycle)) return { ok: false };
  const supabase = await createClient();

  const { error } = await supabase
    .from("students")
    .update({
      year_level: yearLevel?.trim() || null,
      billing_cycle: cycle,
      billing_anchor: anchor || null,
    })
    .eq("id", studentId);

  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}
