"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import type { EnrollmentMode } from "@/lib/db/schema";

/**
 * Enrollment management (Slice A). An enrollment = student × subject × mode,
 * inheriting hourly rate + session length from the matching price_list_item
 * (resolved by the student's year level). Staff only (RLS enforces it too).
 */

const MODES: EnrollmentMode[] = ["one_to_one", "group"];

async function requireStaff() {
  const res = await resolveActiveTenant();
  if (res.status !== "ok") return null;
  if (!["owner", "admin", "tutor"].includes(res.tenant.role)) return null;
  return res.tenant;
}

/**
 * Create an enrollment. Resolves the catalog row from the student's year level +
 * chosen subject + mode, snapshots its rate/length onto the enrollment. Fails
 * loudly if there's no matching price-list row (mirrors today's rate guard).
 */
export async function createEnrollment(input: {
  studentId: string;
  subjectId: string;
  mode: EnrollmentMode;
}): Promise<{ ok: boolean; error?: string }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, error: "Not allowed." };
  if (!input.studentId) return { ok: false, error: "No student." };
  if (!input.subjectId) return { ok: false, error: "Pick a subject." };
  if (!MODES.includes(input.mode)) return { ok: false, error: "Pick a mode." };

  const supabase = await createClient();

  const { data: studentRow } = await supabase
    .from("students")
    .select("tenant_id, year_level")
    .eq("id", input.studentId)
    .single();
  const student = studentRow as unknown as {
    tenant_id: string;
    year_level: string | null;
  } | null;
  if (!student) return { ok: false, error: "Student not found." };
  if (!student.year_level) {
    return {
      ok: false,
      error: "Set the student's year level first — it picks the rate.",
    };
  }

  // Already enrolled in this subject + mode? Don't create a duplicate.
  const { data: dupe } = await supabase
    .from("enrollments")
    .select("id")
    .eq("student_id", input.studentId)
    .eq("subject_id", input.subjectId)
    .eq("mode", input.mode)
    .eq("active", true)
    .limit(1);
  if ((dupe as unknown as { id: string }[] | null)?.length) {
    return { ok: false, error: "Already enrolled in that subject and mode." };
  }

  const { data: priceRow } = await supabase
    .from("price_list_items")
    .select("id, hourly_rate_cents, currency, default_session_minutes")
    .eq("tenant_id", student.tenant_id)
    .eq("year_level", student.year_level)
    .eq("subject_id", input.subjectId)
    .eq("mode", input.mode)
    .eq("active", true)
    .limit(1);
  const price = (priceRow as unknown as {
    id: string;
    hourly_rate_cents: number;
    currency: string;
    default_session_minutes: number;
  }[] | null)?.[0];
  if (!price) {
    return {
      ok: false,
      error: `No price-list rate for ${student.year_level} · that subject · ${
        input.mode === "group" ? "group" : "1:1"
      }. Add it on the Pricing page first.`,
    };
  }

  const { error } = await supabase.from("enrollments").insert({
    tenant_id: student.tenant_id,
    student_id: input.studentId,
    subject_id: input.subjectId,
    mode: input.mode,
    price_list_item_id: price.id,
    hourly_rate_cents: price.hourly_rate_cents,
    currency: price.currency,
    session_minutes: price.default_session_minutes,
  });
  if (error) return { ok: false, error: "Couldn't create the enrollment." };

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Deactivate / reactivate an enrollment. History (lessons) is preserved. */
export async function setEnrollmentActive(
  enrollmentId: string,
  active: boolean,
): Promise<{ ok: boolean }> {
  if (!(await requireStaff())) return { ok: false };
  if (!enrollmentId) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from("enrollments")
    .update({ active, end_date: active ? null : new Date().toISOString().slice(0, 10) })
    .eq("id", enrollmentId);
  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}
