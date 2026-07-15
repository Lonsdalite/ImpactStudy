"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import { loadCalendarWeek } from "@/lib/calendar-data";
import {
  computeWeekOccurrences,
  sydneyNow,
  sydneyWallToUtc,
  weekDates,
} from "@/lib/calendar";
import { blockAmountCents, postedFee } from "@/lib/billing";
import type { LessonStatus } from "@/lib/db/schema";

/**
 * Slice B calendar write actions (doc 26 §2B). The calendar is the marking
 * surface: mark-this-day / mark-this-week materialise the touched `scheduled`
 * occurrences as `attended` and bill them (hours × rate — Slice A math, verbatim).
 * Reschedule = strike the original (`rescheduled`, $0) + a one-off makeup that
 * carries the billing AND the streak → nets exactly ONE billed session.
 *
 * Guardrails (doc 26 §2B):
 *   1. only occurrences at/earlier than now are markable — never future;
 *   2. BATCH undo reverts a whole mark-all in one tap;
 *   3. mark-all SKIPS already-resolved rows (never overwrites a manual exception);
 *   4. group visual-clusters mark every enrollment in the slot (falls out of the
 *      per-occurrence loop — each member is its own occurrence).
 *
 * RLS enforces staff-only writes; we never trust a tenant_id from the client.
 *
 * Slice B.5 hardening (Fable review):
 *   - Occurrence identity is enforced by the DB (partial unique index on
 *     (enrollment_id, date, starts_at) where origin='recurring'), and every
 *     materialising insert here tolerates a unique_violation (23505) — a
 *     double-tap or a second tab can never double-bill.
 *   - Reschedule + its undo run inside single-transaction RPCs with a
 *     re-entrancy guard (original must be scheduled + unlinked) and a lossless
 *     undo payload (prevStatus/prevAmount).
 *   - Every amount_cents write routes through postedFee(status, block,
 *     fee_override_cents) — identical numbers while overrides are null (pilot),
 *     but the doc 26 §2B override seam actually works.
 */

const SB = () => createClient();
const MANUAL: LessonStatus[] = ["attended", "late", "absent", "cancelled"];

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
async function getEnrollment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  enrollmentId: string,
): Promise<EnrollmentBilling | null> {
  const { data } = await supabase
    .from("enrollments")
    .select("tenant_id, student_id, hourly_rate_cents, session_minutes")
    .eq("id", enrollmentId)
    .single();
  return (data as unknown as EnrollmentBilling) ?? null;
}

function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

/** Postgres unique_violation — the occurrence row already exists (someone else
 *  materialised it first). Never an error we surface as corruption. */
function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

// ---------- batch marking (mark this day / this week) ----------

export interface BatchRevert {
  id: string;
  action: "delete" | "scheduled"; // delete a freshly-created row, or revert to scheduled
}

export interface MarkResult {
  ok: boolean;
  count: number;
  reverts: BatchRevert[];
}

/**
 * Materialise every markable, still-`scheduled` occurrence across `dates` as
 * `attended` and bill it. Skips future occurrences (guardrail 1) and anything
 * already resolved (guardrail 3 — only status `scheduled` is touched). Returns
 * reverts for a single batch-undo (guardrail 2).
 */
async function markOccurrences(dates: string[]): Promise<MarkResult> {
  const staff = await requireStaff();
  if (!staff) return { ok: false, count: 0, reverts: [] };
  const supabase = await SB();

  const data = await loadCalendarWeek(staff.tenantId, dates);
  const now = sydneyNow();
  const occurrences = computeWeekOccurrences({ ...data, dates, now });

  const target = occurrences.filter(
    (o) => o.status === "scheduled" && o.markable,
  );

  const reverts: BatchRevert[] = [];

  for (const o of target) {
    const amount = postedFee(
      "attended",
      blockAmountCents(o.durationMinutes, o.hourlyRateCents),
      o.feeOverrideCents,
    );
    if (o.lessonId) {
      // A persisted `scheduled` row (e.g. a note-only touch or a makeup) → attend.
      // Guarded to status='scheduled' so a concurrent manual exception is never
      // clobbered; only a row we actually flipped joins the undo batch.
      const { data: updated } = await supabase
        .from("lessons")
        .update({
          status: "attended",
          amount_cents: amount,
          duration_minutes: o.durationMinutes,
          starts_at: sydneyWallToUtc(o.date, o.startTime).toISOString(),
        })
        .eq("id", o.lessonId)
        .eq("status", "scheduled")
        .select("id");
      if ((updated ?? []).length > 0) {
        reverts.push({ id: o.lessonId, action: "scheduled" });
      }
    } else {
      // Materialise the virtual occurrence. Inserted one row at a time so a
      // unique_violation (someone else marked it in between — double-tap,
      // second tab) skips JUST that occurrence instead of failing the batch.
      const { data: inserted, error } = await supabase
        .from("lessons")
        .insert({
          tenant_id: staff.tenantId,
          student_id: o.studentId,
          enrollment_id: o.enrollmentId,
          date: o.date,
          starts_at: sydneyWallToUtc(o.date, o.startTime).toISOString(),
          status: "attended",
          origin: "recurring",
          duration_minutes: o.durationMinutes,
          amount_cents: amount,
        })
        .select("id")
        .single();
      if (!error && inserted) {
        reverts.push({
          id: (inserted as unknown as { id: string }).id,
          action: "delete",
        });
      } else if (error && !isUniqueViolation(error)) {
        // A real failure (not "already materialised") — stop and report what
        // we did so the undo toast is accurate.
        revalidatePath("/dashboard", "layout");
        return { ok: false, count: reverts.length, reverts };
      }
    }
  }

  revalidatePath("/dashboard", "layout");
  return { ok: true, count: reverts.length, reverts };
}

export async function markDayAttended(dateIso: string): Promise<MarkResult> {
  if (!dateIso) return { ok: false, count: 0, reverts: [] };
  return markOccurrences([dateIso]);
}

export async function markWeekAttended(mondayIso: string): Promise<MarkResult> {
  if (!mondayIso) return { ok: false, count: 0, reverts: [] };
  return markOccurrences(weekDates(mondayIso));
}

/** Batch undo for a mark-all: delete freshly-created rows + revert the rest. */
export async function undoMark(reverts: BatchRevert[]): Promise<{ ok: boolean }> {
  if (!(await requireStaff())) return { ok: false };
  if (!reverts || reverts.length === 0) return { ok: true };
  const supabase = await SB();

  const dels = reverts.filter((r) => r.action === "delete").map((r) => r.id);
  const scheds = reverts.filter((r) => r.action === "scheduled").map((r) => r.id);
  if (dels.length > 0) await supabase.from("lessons").delete().in("id", dels);
  if (scheds.length > 0) {
    await supabase
      .from("lessons")
      .update({ status: "scheduled", amount_cents: 0 })
      .in("id", scheds);
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

// ---------- single-occurrence marking (per-day register drill-down) ----------

export interface OccurrenceRef {
  lessonId: string | null;
  enrollmentId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
}

/**
 * Mark ONE occurrence (attended / late / absent / cancelled) from the drill-down.
 * Materialises the row if virtual. Returns the lesson id + previous status so the
 * toast can offer a per-item undo.
 */
export async function setOccurrenceStatus(
  ref: OccurrenceRef,
  status: LessonStatus,
): Promise<{ ok: boolean; lessonId: string | null; prev: LessonStatus | null }> {
  if (!(await requireStaff())) return { ok: false, lessonId: null, prev: null };
  if (!MANUAL.includes(status)) return { ok: false, lessonId: null, prev: null };
  const supabase = await SB();

  const enr = await getEnrollment(supabase, ref.enrollmentId);
  if (!enr) return { ok: false, lessonId: null, prev: null };

  const duration =
    Number.isFinite(ref.durationMinutes) && ref.durationMinutes > 0
      ? Math.round(ref.durationMinutes)
      : enr.session_minutes;
  const block = blockAmountCents(duration, enr.hourly_rate_cents);

  if (ref.lessonId) {
    const { data: existing } = await supabase
      .from("lessons")
      .select("status, fee_override_cents")
      .eq("id", ref.lessonId)
      .single();
    const row = existing as unknown as {
      status: LessonStatus;
      fee_override_cents: number | null;
    } | null;
    if (!row) return { ok: false, lessonId: null, prev: null };
    const { data: updated, error } = await supabase
      .from("lessons")
      .update({
        status,
        amount_cents: postedFee(status, block, row.fee_override_cents),
        duration_minutes: duration,
      })
      .eq("id", ref.lessonId)
      .select("id");
    revalidatePath("/dashboard", "layout");
    return {
      ok: !error && (updated ?? []).length > 0,
      lessonId: ref.lessonId,
      prev: row.status,
    };
  }

  const { data: inserted, error } = await supabase
    .from("lessons")
    .insert({
      tenant_id: enr.tenant_id,
      student_id: enr.student_id,
      enrollment_id: ref.enrollmentId,
      date: ref.date,
      starts_at: sydneyWallToUtc(ref.date, ref.startTime).toISOString(),
      status,
      origin: "recurring",
      duration_minutes: duration,
      amount_cents: postedFee(status, block, null),
    })
    .select("id")
    .single();
  revalidatePath("/dashboard", "layout");
  if (error && isUniqueViolation(error)) {
    // Someone materialised this occurrence in between (double-tap / second
    // tab). Nothing was written; the refreshed calendar shows the truth.
    return { ok: false, lessonId: null, prev: null };
  }
  return {
    ok: !error,
    lessonId: (inserted as unknown as { id: string } | null)?.id ?? null,
    prev: null,
  };
}

/** Undo a single mark: restore prev status (recompute fee) or delete if new. */
export async function restoreOccurrence(
  lessonId: string,
  prev: LessonStatus | null,
): Promise<{ ok: boolean }> {
  if (!(await requireStaff())) return { ok: false };
  if (!lessonId) return { ok: false };
  const supabase = await SB();

  if (prev === null) {
    const { data: deleted, error } = await supabase
      .from("lessons")
      .delete()
      .eq("id", lessonId)
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
 * Capture the "what we covered" one-line note (doc 24 heartbeat fuel). If the
 * occurrence is still virtual, persist a `scheduled` row to hold the note.
 */
export async function setOccurrenceNote(
  ref: OccurrenceRef,
  note: string,
): Promise<{ ok: boolean; lessonId: string | null }> {
  if (!(await requireStaff())) return { ok: false, lessonId: null };
  const supabase = await SB();
  const trimmed = note.trim();

  let lessonId = ref.lessonId;
  if (!lessonId) {
    const enr = await getEnrollment(supabase, ref.enrollmentId);
    if (!enr) return { ok: false, lessonId: null };
    const startsAt = sydneyWallToUtc(ref.date, ref.startTime).toISOString();
    const { data: inserted, error } = await supabase
      .from("lessons")
      .insert({
        tenant_id: enr.tenant_id,
        student_id: enr.student_id,
        enrollment_id: ref.enrollmentId,
        date: ref.date,
        starts_at: startsAt,
        status: "scheduled",
        origin: "recurring",
        duration_minutes:
          ref.durationMinutes > 0 ? Math.round(ref.durationMinutes) : enr.session_minutes,
        amount_cents: 0,
      })
      .select("id")
      .single();
    lessonId = (inserted as unknown as { id: string } | null)?.id ?? null;
    if (!lessonId && isUniqueViolation(error)) {
      // The occurrence was materialised in between — attach the note to the
      // existing row instead of failing.
      const { data: existing } = await supabase
        .from("lessons")
        .select("id")
        .eq("enrollment_id", ref.enrollmentId)
        .eq("date", ref.date)
        .eq("starts_at", startsAt)
        .eq("origin", "recurring")
        .limit(1);
      lessonId =
        (existing as unknown as { id: string }[] | null)?.[0]?.id ?? null;
    }
  }
  if (!lessonId) return { ok: false, lessonId: null };

  const { error } = await supabase
    .from("lessons")
    .update({ note: trimmed.length > 0 ? trimmed : null })
    .eq("id", lessonId);
  revalidatePath("/dashboard", "layout");
  return { ok: !error, lessonId };
}

// ---------- reschedule (this week) — strike original + one-off makeup ----------

export interface RescheduleUndo {
  originalId: string;
  originalWasVirtual: boolean;
  makeupId: string;
  /** True prior state of the original, so undo restores exactly what was there. */
  prevStatus: LessonStatus;
  prevAmount: number;
}

/**
 * "Reschedule this week": strike the original occurrence (`rescheduled`, $0,
 * linked) and create a one-off MAKEUP at the new datetime inheriting the
 * enrollment's rate/duration. The recurrence rule is untouched; billing nets ONE
 * session (original $0 + makeup, which bills only once marked attended).
 *
 * Runs in ONE transaction via the reschedule_occurrence RPC (policies.sql
 * §11g), which also guards re-entry: an original that is already marked or
 * already rescheduled is rejected, so a double-tap can never mint a second
 * makeup (the "nets exactly ONE billed session" invariant, doc 26 §2B).
 */
export async function rescheduleOccurrence(input: {
  lessonId: string | null;
  enrollmentId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  newDate: string;
  newStartTime: string;
}): Promise<{ ok: boolean; error?: string; undo?: RescheduleUndo }> {
  if (!(await requireStaff())) return { ok: false, error: "Not allowed." };
  if (!isValidTime(input.newStartTime)) return { ok: false, error: "Bad time." };
  if (!input.newDate) return { ok: false, error: "Pick a date." };
  const supabase = await SB();

  const enr = await getEnrollment(supabase, input.enrollmentId);
  if (!enr) return { ok: false, error: "Enrollment not found." };

  const duration =
    Number.isFinite(input.durationMinutes) && input.durationMinutes > 0
      ? Math.round(input.durationMinutes)
      : enr.session_minutes;

  const { data, error } = await supabase.rpc("reschedule_occurrence", {
    p_lesson_id: input.lessonId,
    p_enrollment_id: input.enrollmentId,
    p_date: input.date,
    p_starts_at: sydneyWallToUtc(input.date, input.startTime).toISOString(),
    p_duration_minutes: duration,
    p_new_date: input.newDate,
    p_new_starts_at: sydneyWallToUtc(
      input.newDate,
      input.newStartTime,
    ).toISOString(),
  });
  revalidatePath("/dashboard", "layout");
  if (error) return { ok: false, error: "Couldn't reschedule." };
  const res = data as unknown as {
    ok: boolean;
    error?: string;
    original_id?: string;
    original_was_virtual?: boolean;
    makeup_id?: string;
    prev_status?: LessonStatus;
    prev_amount?: number;
  };
  if (!res?.ok) return { ok: false, error: res?.error ?? "Couldn't reschedule." };
  return {
    ok: true,
    undo: {
      originalId: res.original_id!,
      originalWasVirtual: res.original_was_virtual ?? false,
      makeupId: res.makeup_id!,
      prevStatus: res.prev_status ?? "scheduled",
      prevAmount: res.prev_amount ?? 0,
    },
  };
}

/**
 * Undo a reschedule: remove the makeup + restore the original to its TRUE prior
 * state (prevStatus/prevAmount — never a blind reset to `scheduled`). One
 * transaction via the undo_reschedule RPC; refuses if the makeup was already
 * marked (undo that mark first).
 */
export async function undoReschedule(
  u: RescheduleUndo,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireStaff())) return { ok: false, error: "Not allowed." };
  const supabase = await SB();
  const { data, error } = await supabase.rpc("undo_reschedule", {
    p_original_id: u.originalId,
    p_makeup_id: u.makeupId,
    p_original_was_virtual: u.originalWasVirtual,
    p_prev_status: u.prevStatus,
    p_prev_amount: u.prevAmount,
  });
  revalidatePath("/dashboard", "layout");
  if (error) return { ok: false, error: "Couldn't undo." };
  const res = data as unknown as { ok: boolean; error?: string };
  if (!res?.ok) return { ok: false, error: res?.error ?? "Couldn't undo." };
  return { ok: true };
}

// ---------- schedule CRUD ("change days from now on") ----------

/** Add a weekly slot to an enrollment. effectiveFrom defaults to today (Sydney). */
export async function addSchedule(input: {
  enrollmentId: string;
  weekday: number;
  startTime: string;
  durationOverride?: number | null;
  effectiveFrom?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireStaff())) return { ok: false, error: "Not allowed." };
  if (input.weekday < 0 || input.weekday > 6) return { ok: false, error: "Bad day." };
  if (!isValidTime(input.startTime)) return { ok: false, error: "Time must be HH:MM." };
  const supabase = await SB();

  const enr = await getEnrollment(supabase, input.enrollmentId);
  if (!enr) return { ok: false, error: "Enrollment not found." };

  const override =
    input.durationOverride != null && Number.isFinite(input.durationOverride)
      ? Math.round(input.durationOverride)
      : null;

  const { error } = await supabase.from("enrollment_schedules").insert({
    tenant_id: enr.tenant_id,
    enrollment_id: input.enrollmentId,
    weekday: input.weekday,
    start_time: input.startTime,
    duration_override: override && override > 0 ? override : null,
    effective_from: input.effectiveFrom ?? sydneyNow().date,
  });
  if (error) return { ok: false, error: "Couldn't add the slot." };
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/**
 * End a slot "from now on": set effective_to = today (Sydney). Past weeks still
 * render this slot (history); no new occurrences generate after today.
 */
export async function endSchedule(scheduleId: string): Promise<{ ok: boolean }> {
  if (!(await requireStaff())) return { ok: false };
  if (!scheduleId) return { ok: false };
  const supabase = await SB();
  const { data: updated, error } = await supabase
    .from("enrollment_schedules")
    .update({ effective_to: sydneyNow().date })
    .eq("id", scheduleId)
    .select("id");
  revalidatePath("/dashboard", "layout");
  return { ok: !error && (updated ?? []).length > 0 };
}

/** Hard-delete a slot (added by mistake). Use endSchedule to preserve history. */
export async function deleteSchedule(scheduleId: string): Promise<{ ok: boolean }> {
  if (!(await requireStaff())) return { ok: false };
  if (!scheduleId) return { ok: false };
  const supabase = await SB();
  const { data: deleted, error } = await supabase
    .from("enrollment_schedules")
    .delete()
    .eq("id", scheduleId)
    .select("id");
  revalidatePath("/dashboard", "layout");
  return { ok: !error && (deleted ?? []).length > 0 };
}
