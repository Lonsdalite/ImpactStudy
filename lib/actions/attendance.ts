"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { feeForStatus } from "@/lib/billing";
import type { LessonStatus } from "@/lib/db/schema";

/**
 * Attendance write actions. Called imperatively from client components so we can
 * show toast confirmations + undo. Each returns enough to undo. RLS enforces
 * staff-only writes; we never trust a tenant_id from the client.
 */

const VALID: LessonStatus[] = ["present", "absent", "late", "cancelled"];

interface StudentBilling {
  tenant_id: string;
  default_rate_card_id: string | null;
  rate: { amount_cents: number } | null;
}

async function getBilling(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
): Promise<StudentBilling | null> {
  const { data } = await supabase
    .from("students")
    .select("tenant_id, default_rate_card_id, rate:rate_cards(amount_cents)")
    .eq("id", studentId)
    .single();
  return (data as unknown as StudentBilling) ?? null;
}

export async function markAttendance(
  studentId: string,
  date: string,
  status: LessonStatus,
): Promise<{ ok: boolean; prev: LessonStatus | null }> {
  if (!studentId || !date || !VALID.includes(status)) {
    return { ok: false, prev: null };
  }
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("lessons")
    .select("status")
    .eq("student_id", studentId)
    .eq("date", date)
    .maybeSingle();
  const prev =
    (existing as unknown as { status: LessonStatus } | null)?.status ?? null;

  const billing = await getBilling(supabase, studentId);
  if (!billing) return { ok: false, prev: null };

  const { error } = await supabase.from("lessons").upsert(
    {
      tenant_id: billing.tenant_id,
      student_id: studentId,
      date,
      status,
      amount_cents: feeForStatus(status, billing.rate?.amount_cents ?? 0),
      rate_card_id: billing.default_rate_card_id,
    },
    { onConflict: "student_id,date" },
  );

  revalidatePath("/dashboard", "layout");
  return { ok: !error, prev };
}

/** Undo helper: restore a lesson to its previous status, or remove it. */
export async function restoreLesson(
  studentId: string,
  date: string,
  prev: LessonStatus | null,
): Promise<{ ok: boolean }> {
  if (prev === null) {
    const supabase = await createClient();
    const { error } = await supabase
      .from("lessons")
      .delete()
      .eq("student_id", studentId)
      .eq("date", date);
    revalidatePath("/dashboard", "layout");
    return { ok: !error };
  }
  return { ok: (await markAttendance(studentId, date, prev)).ok };
}

/**
 * Mark every still-unmarked active student present for `date` (the 80/20 flow:
 * most attend; mark the exceptions after). Leaves already-marked students alone
 * so it never clobbers an exception you've set.
 */
export async function markAllPresent(
  date: string,
): Promise<{ ok: boolean; count: number }> {
  if (!date) return { ok: false, count: 0 };
  const supabase = await createClient();

  const [{ data: studentRows }, { data: lessonRows }] = await Promise.all([
    supabase
      .from("students")
      .select("id, tenant_id, default_rate_card_id, rate:rate_cards(amount_cents)")
      .eq("active", true),
    supabase.from("lessons").select("student_id").eq("date", date),
  ]);

  const students = (studentRows ?? []) as unknown as ({ id: string } & StudentBilling)[];
  const marked = new Set(
    ((lessonRows ?? []) as unknown as { student_id: string }[]).map(
      (l) => l.student_id,
    ),
  );

  const toInsert = students
    .filter((s) => !marked.has(s.id))
    .map((s) => ({
      tenant_id: s.tenant_id,
      student_id: s.id,
      date,
      status: "present" as const,
      amount_cents: feeForStatus("present", s.rate?.amount_cents ?? 0),
      rate_card_id: s.default_rate_card_id,
    }));

  let count = 0;
  if (toInsert.length > 0) {
    const { error } = await supabase
      .from("lessons")
      .upsert(toInsert, { onConflict: "student_id,date" });
    if (!error) count = toInsert.length;
  }

  revalidatePath("/dashboard", "layout");
  return { ok: true, count };
}
