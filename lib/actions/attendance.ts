"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import { blockAmountCents, postedFee, todaySydney } from "@/lib/billing";
import type { LessonStatus } from "@/lib/db/schema";

/**
 * Attendance write actions — the per-enrollment REGISTER path (Slice A). A
 * lesson belongs to an ENROLLMENT (student × subject × mode), and its fee is
 *   postedFee(status, round(duration_minutes / 60 × enrollment.hourly_rate_cents),
 *             fee_override_cents).
 *
 * Slice B.5 hardening (Fable review §3 P1):
 *   - The bulk "mark all present" is RETIRED. The calendar is the marking
 *     surface (doc 33 §5); the old bulk action was schedule-unaware (billed
 *     weekdays with no slot), future-markable, and had no tenant filter.
 *     The register remains as a deliberate per-enrollment exception surface.
 *   - Every action here now checks staff membership in code (doc 06 §6's
 *     second enforcement layer, not just RLS), scopes writes to the active
 *     tenant, refuses future dates, and verifies affected-row counts so an
 *     RLS no-op can never report success.
 */

const VALID: LessonStatus[] = ["attended", "absent", "late", "cancelled"];

type SB = Awaited<ReturnType<typeof createClient>>;

async function requireStaff(): Promise<{ tenantId: string } | null> {
  const res = await resolveActiveTenant();
  if (res.status !== "ok") return null;
  if (!["owner", "admin", "tutor"].includes(res.tenant.role)) return null;
  return { tenantId: res.tenant.tenantId };
}

interface EnrollmentBilling {
  tenant_id: string;
  student_id: string;
  hourly_rate_cents: number;
  session_minutes: number;
}

async function getEnrollmentBilling(
  supabase: SB,
  tenantId: string,
  enrollmentId: string,
): Promise<EnrollmentBilling | null> {
  const { data } = await supabase
    .from("enrollments")
    .select("tenant_id, student_id, hourly_rate_cents, session_minutes")
    .eq("id", enrollmentId)
    .eq("tenant_id", tenantId)
    .single();
  return (data as unknown as EnrollmentBilling) ?? null;
}

/**
 * Mark the canonical (one-per-enrollment-per-day) lesson for an enrollment.
 * Updates the existing row for (enrollment, date) if there is one, else inserts.
 * `durationOverride` (minutes) lets a single long class bill more than the
 * enrollment default without adding a second session. Never a future date
 * (guardrail 1, doc 26 §2B — now on this surface too).
 */
export async function markAttendance(
  enrollmentId: string,
  date: string,
  status: LessonStatus,
  durationOverride?: number,
): Promise<{ ok: boolean; lessonId: string | null; prev: LessonStatus | null }> {
  const staff = await requireStaff();
  if (!staff) return { ok: false, lessonId: null, prev: null };
  if (!enrollmentId || !date || !VALID.includes(status)) {
    return { ok: false, lessonId: null, prev: null };
  }
  if (date > todaySydney()) return { ok: false, lessonId: null, prev: null };
  const supabase = await createClient();

  const billing = await getEnrollmentBilling(supabase, staff.tenantId, enrollmentId);
  if (!billing) return { ok: false, lessonId: null, prev: null };

  const duration =
    Number.isFinite(durationOverride) && (durationOverride as number) > 0
      ? Math.round(durationOverride as number)
      : billing.session_minutes;
  const block = blockAmountCents(duration, billing.hourly_rate_cents);

  // Canonical existing row for this (enrollment, date) — the earliest one.
  const { data: existing } = await supabase
    .from("lessons")
    .select("id, status, fee_override_cents")
    .eq("enrollment_id", enrollmentId)
    .eq("date", date)
    .order("created_at", { ascending: true })
    .limit(1);
  const current = (existing as unknown as {
    id: string;
    status: LessonStatus;
    fee_override_cents: number | null;
  }[] | null)?.[0];

  if (current) {
    const { data: updated, error } = await supabase
      .from("lessons")
      .update({
        status,
        duration_minutes: duration,
        amount_cents: postedFee(status, block, current.fee_override_cents),
      })
      .eq("id", current.id)
      .select("id");
    revalidatePath("/dashboard", "layout");
    return {
      ok: !error && (updated ?? []).length > 0,
      lessonId: current.id,
      prev: current.status,
    };
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
      amount_cents: postedFee(status, block, null),
    })
    .select("id")
    .single();
  revalidatePath("/dashboard", "layout");
  // 23505 = the occurrence-identity index caught a concurrent insert for this
  // (enrollment, date) — nothing was written; the refresh shows the truth.
  return {
    ok: !error,
    lessonId: (inserted as unknown as { id: string } | null)?.id ?? null,
    prev: null,
  };
}

/**
 * "Add another session" — the double / long-class escape (doc 27 §2.3). Always
 * INSERTS a new lesson row for the enrollment on that date (never upserts), so a
 * 2h block on a 1h enrollment bills as two sessions. `origin: oneoff` — a bare
 * extra class outside the recurrence, exempt from the occurrence-identity index
 * by design (keyed by id). Returns the new id to undo.
 */
export async function addSession(
  enrollmentId: string,
  date: string,
  status: LessonStatus,
  durationMinutes?: number,
): Promise<{ ok: boolean; lessonId: string | null }> {
  const staff = await requireStaff();
  if (!staff) return { ok: false, lessonId: null };
  if (!enrollmentId || !date || !VALID.includes(status)) {
    return { ok: false, lessonId: null };
  }
  if (date > todaySydney()) return { ok: false, lessonId: null };
  const supabase = await createClient();
  const billing = await getEnrollmentBilling(supabase, staff.tenantId, enrollmentId);
  if (!billing) return { ok: false, lessonId: null };

  const duration =
    Number.isFinite(durationMinutes) && (durationMinutes as number) > 0
      ? Math.round(durationMinutes as number)
      : billing.session_minutes;

  const { data: inserted, error } = await supabase
    .from("lessons")
    .insert({
      tenant_id: billing.tenant_id,
      student_id: billing.student_id,
      enrollment_id: enrollmentId,
      date,
      status,
      origin: "oneoff",
      duration_minutes: duration,
      amount_cents: postedFee(
        status,
        blockAmountCents(duration, billing.hourly_rate_cents),
        null,
      ),
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
  const staff = await requireStaff();
  if (!staff || !lessonId) return { ok: false };
  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from("lessons")
    .delete()
    .eq("id", lessonId)
    .eq("tenant_id", staff.tenantId)
    .select("id");
  revalidatePath("/dashboard", "layout");
  return { ok: !error && (deleted ?? []).length > 0 };
}

/**
 * Undo a mark: restore a lesson to its previous status (recomputing the fee from
 * its own stored duration + enrollment rate + override), or delete it if it was
 * freshly created (prev === null).
 */
export async function restoreLesson(
  lessonId: string,
  prev: LessonStatus | null,
): Promise<{ ok: boolean }> {
  const staff = await requireStaff();
  if (!staff || !lessonId) return { ok: false };
  const supabase = await createClient();

  if (prev === null) {
    const { data: deleted, error } = await supabase
      .from("lessons")
      .delete()
      .eq("id", lessonId)
      .eq("tenant_id", staff.tenantId)
      .select("id");
    revalidatePath("/dashboard", "layout");
    return { ok: !error && (deleted ?? []).length > 0 };
  }

  const { data } = await supabase
    .from("lessons")
    .select(
      "duration_minutes, fee_override_cents, enrollment:enrollments(hourly_rate_cents)",
    )
    .eq("id", lessonId)
    .eq("tenant_id", staff.tenantId)
    .single();
  const row = data as unknown as {
    duration_minutes: number;
    fee_override_cents: number | null;
    enrollment: { hourly_rate_cents: number } | null;
  } | null;
  if (!row) return { ok: false };

  const amount = postedFee(
    prev,
    blockAmountCents(row.duration_minutes, row.enrollment?.hourly_rate_cents ?? 0),
    row.fee_override_cents,
  );
  const { data: updated, error } = await supabase
    .from("lessons")
    .update({ status: prev, amount_cents: amount })
    .eq("id", lessonId)
    .select("id");
  revalidatePath("/dashboard", "layout");
  return { ok: !error && (updated ?? []).length > 0 };
}

/**
 * Capture the one-line "what we covered" against a lesson (the fuel for the
 * weekly parent heartbeat, doc 20 §7.2). Keyed by lesson id now that a student
 * can have several lessons a day. Staff-only in code AND in RLS.
 */
export async function setLessonNote(
  lessonId: string,
  note: string,
): Promise<{ ok: boolean }> {
  const staff = await requireStaff();
  if (!staff || !lessonId) return { ok: false };
  const supabase = await createClient();
  const trimmed = note.trim();
  const { data: updated, error } = await supabase
    .from("lessons")
    .update({ note: trimmed.length > 0 ? trimmed : null })
    .eq("id", lessonId)
    .eq("tenant_id", staff.tenantId)
    .select("id");
  revalidatePath("/dashboard", "layout");
  return { ok: !error && (updated ?? []).length > 0 };
}

// markAllPresent + deleteLessons (the register's bulk mark and its batch undo)
// were RETIRED in Slice B.5: the calendar's mark-day/mark-week is the one bulk
// marking engine (schedule-aware, tenant-scoped, future-guarded, batch-undo).
// See doc 35b §3 P1 / doc 35c A5.
