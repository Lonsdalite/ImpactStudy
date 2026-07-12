"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { blockAmountCents, feeForStatus } from "@/lib/billing";
import type { LessonStatus } from "@/lib/db/schema";

/**
 * Attendance write actions — now enrollment-scoped (Slice A). A lesson belongs to
 * an ENROLLMENT (student × subject × mode), and its fee is
 *   feeForStatus(status, round(duration_minutes / 60 × enrollment.hourly_rate_cents)).
 *
 * The DB no longer enforces one-lesson-per-student-per-day. The convention is
 * one lesson per (enrollment, date) for the normal register mark; a double / long
 * class inserts an extra row via addSession (doc 27 §2.3). Called imperatively
 * from client components for toast-with-undo. RLS enforces staff-only writes; we
 * never trust a tenant_id from the client.
 */

const VALID: LessonStatus[] = ["attended", "absent", "late", "cancelled"];

type SB = Awaited<ReturnType<typeof createClient>>;

interface EnrollmentBilling {
  tenant_id: string;
  student_id: string;
  hourly_rate_cents: number;
  session_minutes: number;
}

async function getEnrollmentBilling(
  supabase: SB,
  enrollmentId: string,
): Promise<EnrollmentBilling | null> {
  const { data } = await supabase
    .from("enrollments")
    .select("tenant_id, student_id, hourly_rate_cents, session_minutes")
    .eq("id", enrollmentId)
    .single();
  return (data as unknown as EnrollmentBilling) ?? null;
}

/**
 * Mark the canonical (one-per-enrollment-per-day) lesson for an enrollment.
 * Updates the existing row for (enrollment, date) if there is one, else inserts.
 * `durationOverride` (minutes) lets a single long class bill more than the
 * enrollment default without adding a second session.
 */
export async function markAttendance(
  enrollmentId: string,
  date: string,
  status: LessonStatus,
  durationOverride?: number,
): Promise<{ ok: boolean; lessonId: string | null; prev: LessonStatus | null }> {
  if (!enrollmentId || !date || !VALID.includes(status)) {
    return { ok: false, lessonId: null, prev: null };
  }
  const supabase = await createClient();

  const billing = await getEnrollmentBilling(supabase, enrollmentId);
  if (!billing) return { ok: false, lessonId: null, prev: null };

  const duration =
    Number.isFinite(durationOverride) && (durationOverride as number) > 0
      ? Math.round(durationOverride as number)
      : billing.session_minutes;
  const amount = feeForStatus(
    status,
    blockAmountCents(duration, billing.hourly_rate_cents),
  );

  // Canonical existing row for this (enrollment, date) — the earliest one.
  const { data: existing } = await supabase
    .from("lessons")
    .select("id, status")
    .eq("enrollment_id", enrollmentId)
    .eq("date", date)
    .order("created_at", { ascending: true })
    .limit(1);
  const current = (existing as unknown as { id: string; status: LessonStatus }[] | null)?.[0];
  const prev = current?.status ?? null;

  if (current) {
    const { error } = await supabase
      .from("lessons")
      .update({ status, duration_minutes: duration, amount_cents: amount })
      .eq("id", current.id);
    revalidatePath("/dashboard", "layout");
    return { ok: !error, lessonId: current.id, prev };
  }

  const { data: inserted, error } = await supabase
    .from("lessons")
    .insert({
      tenant_id: billing.tenant_id,
      student_id: billing.student_id,
      enrollment_id: enrollmentId,
      date,
      status,
      duration_minutes: duration,
      amount_cents: amount,
    })
    .select("id")
    .single();
  revalidatePath("/dashboard", "layout");
  return {
    ok: !error,
    lessonId: (inserted as unknown as { id: string } | null)?.id ?? null,
    prev: null,
  };
}

/**
 * "Add another session" — the double / long-class escape (doc 27 §2.3). Always
 * INSERTS a new lesson row for the enrollment on that date (never upserts), so a
 * 2h block on a 1h enrollment bills as two sessions. Returns the new id to undo.
 */
export async function addSession(
  enrollmentId: string,
  date: string,
  status: LessonStatus,
  durationMinutes?: number,
): Promise<{ ok: boolean; lessonId: string | null }> {
  if (!enrollmentId || !date || !VALID.includes(status)) {
    return { ok: false, lessonId: null };
  }
  const supabase = await createClient();
  const billing = await getEnrollmentBilling(supabase, enrollmentId);
  if (!billing) return { ok: false, lessonId: null };

  const duration =
    Number.isFinite(durationMinutes) && (durationMinutes as number) > 0
      ? Math.round(durationMinutes as number)
      : billing.session_minutes;
  const amount = feeForStatus(
    status,
    blockAmountCents(duration, billing.hourly_rate_cents),
  );

  const { data: inserted, error } = await supabase
    .from("lessons")
    .insert({
      tenant_id: billing.tenant_id,
      student_id: billing.student_id,
      enrollment_id: enrollmentId,
      date,
      status,
      duration_minutes: duration,
      amount_cents: amount,
    })
    .select("id")
    .single();
  revalidatePath("/dashboard", "layout");
  return {
    ok: !error,
    lessonId: (inserted as unknown as { id: string } | null)?.id ?? null,
  };
}

/** Delete one lesson row by id (undo for addSession / an extra session). */
export async function deleteLesson(
  lessonId: string,
): Promise<{ ok: boolean }> {
  if (!lessonId) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("lessons").delete().eq("id", lessonId);
  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}

/**
 * Undo a mark: restore a lesson to its previous status (recomputing the fee from
 * its own stored duration + enrollment rate), or delete it if it was freshly
 * created (prev === null).
 */
export async function restoreLesson(
  lessonId: string,
  prev: LessonStatus | null,
): Promise<{ ok: boolean }> {
  if (!lessonId) return { ok: false };
  const supabase = await createClient();

  if (prev === null) {
    const { error } = await supabase.from("lessons").delete().eq("id", lessonId);
    revalidatePath("/dashboard", "layout");
    return { ok: !error };
  }

  const { data } = await supabase
    .from("lessons")
    .select("duration_minutes, enrollment:enrollments(hourly_rate_cents)")
    .eq("id", lessonId)
    .single();
  const row = data as unknown as {
    duration_minutes: number;
    enrollment: { hourly_rate_cents: number } | null;
  } | null;
  if (!row) return { ok: false };

  const amount = feeForStatus(
    prev,
    blockAmountCents(row.duration_minutes, row.enrollment?.hourly_rate_cents ?? 0),
  );
  const { error } = await supabase
    .from("lessons")
    .update({ status: prev, amount_cents: amount })
    .eq("id", lessonId);
  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}

/**
 * Capture the one-line "what we covered" against a lesson (the fuel for the
 * weekly parent heartbeat, doc 20 §7.2). Keyed by lesson id now that a student
 * can have several lessons a day. RLS enforces staff-only writes.
 */
export async function setLessonNote(
  lessonId: string,
  note: string,
): Promise<{ ok: boolean }> {
  if (!lessonId) return { ok: false };
  const supabase = await createClient();
  const trimmed = note.trim();
  const { error } = await supabase
    .from("lessons")
    .update({ note: trimmed.length > 0 ? trimmed : null })
    .eq("id", lessonId);
  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}

/**
 * Mark every active enrollment with NO lesson yet on `date` as present (the
 * 80/20 flow: most attend; fix exceptions after). Skips enrollments already
 * touched that day so it never clobbers an exception. Returns the created lesson
 * ids for a single batch-undo.
 */
export async function markAllPresent(
  date: string,
): Promise<{ ok: boolean; count: number; lessonIds: string[] }> {
  if (!date) return { ok: false, count: 0, lessonIds: [] };
  const supabase = await createClient();

  const [{ data: enrollmentRows }, { data: lessonRows }] = await Promise.all([
    supabase
      .from("enrollments")
      .select(
        "id, tenant_id, student_id, hourly_rate_cents, session_minutes, student:students(active)",
      )
      .eq("active", true),
    supabase.from("lessons").select("enrollment_id").eq("date", date),
  ]);

  const enrollments = (enrollmentRows ?? []) as unknown as (EnrollmentBilling & {
    id: string;
    student: { active: boolean } | null;
  })[];
  const touched = new Set(
    ((lessonRows ?? []) as unknown as { enrollment_id: string | null }[])
      .map((l) => l.enrollment_id)
      .filter((id): id is string => !!id),
  );

  const toInsert = enrollments
    .filter((e) => e.student?.active !== false && !touched.has(e.id))
    .map((e) => ({
      tenant_id: e.tenant_id,
      student_id: e.student_id,
      enrollment_id: e.id,
      date,
      status: "attended" as const,
      duration_minutes: e.session_minutes,
      amount_cents: feeForStatus(
        "attended",
        blockAmountCents(e.session_minutes, e.hourly_rate_cents),
      ),
    }));

  let lessonIds: string[] = [];
  if (toInsert.length > 0) {
    const { data: inserted, error } = await supabase
      .from("lessons")
      .insert(toInsert)
      .select("id");
    if (!error) {
      lessonIds = ((inserted ?? []) as unknown as { id: string }[]).map(
        (r) => r.id,
      );
    }
  }

  revalidatePath("/dashboard", "layout");
  return { ok: true, count: lessonIds.length, lessonIds };
}

/** Batch undo for markAllPresent — delete every lesson it created. */
export async function deleteLessons(
  lessonIds: string[],
): Promise<{ ok: boolean }> {
  if (!lessonIds || lessonIds.length === 0) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase
    .from("lessons")
    .delete()
    .in("id", lessonIds);
  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}
