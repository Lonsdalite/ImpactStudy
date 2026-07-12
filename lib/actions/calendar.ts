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
import { blockAmountCents, feeForStatus } from "@/lib/billing";
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
  const toInsert: Record<string, unknown>[] = [];

  for (const o of target) {
    const amount = feeForStatus(
      "attended",
      blockAmountCents(o.durationMinutes, o.hourlyRateCents),
    );
    if (o.lessonId) {
      // A persisted `scheduled` row (e.g. a note-only touch or a makeup) → attend.
      await supabase
        .from("lessons")
        .update({
          status: "attended",
          amount_cents: amount,
          duration_minutes: o.durationMinutes,
          starts_at: sydneyWallToUtc(o.date, o.startTime).toISOString(),
        })
        .eq("id", o.lessonId);
      reverts.push({ id: o.lessonId, action: "scheduled" });
    } else {
      toInsert.push({
        tenant_id: staff.tenantId,
        student_id: o.studentId,
        enrollment_id: o.enrollmentId,
        date: o.date,
        starts_at: sydneyWallToUtc(o.date, o.startTime).toISOString(),
        status: "attended",
        origin: "recurring",
        duration_minutes: o.durationMinutes,
        amount_cents: amount,
      });
    }
  }

  if (toInsert.length > 0) {
    const { data: inserted } = await supabase
      .from("lessons")
      .insert(toInsert)
      .select("id");
    for (const r of (inserted ?? []) as unknown as { id: string }[]) {
      reverts.push({ id: r.id, action: "delete" });
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
  const amount = feeForStatus(status, blockAmountCents(duration, enr.hourly_rate_cents));

  if (ref.lessonId) {
    const { data: existing } = await supabase
      .from("lessons")
      .select("status")
      .eq("id", ref.lessonId)
      .single();
    const prev = (existing as unknown as { status: LessonStatus } | null)?.status ?? null;
    const { error } = await supabase
      .from("lessons")
      .update({ status, amount_cents: amount, duration_minutes: duration })
      .eq("id", ref.lessonId);
    revalidatePath("/dashboard", "layout");
    return { ok: !error, lessonId: ref.lessonId, prev };
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

/** Undo a single mark: restore prev status (recompute fee) or delete if new. */
export async function restoreOccurrence(
  lessonId: string,
  prev: LessonStatus | null,
): Promise<{ ok: boolean }> {
  if (!(await requireStaff())) return { ok: false };
  if (!lessonId) return { ok: false };
  const supabase = await SB();

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
    const { data: inserted } = await supabase
      .from("lessons")
      .insert({
        tenant_id: enr.tenant_id,
        student_id: enr.student_id,
        enrollment_id: ref.enrollmentId,
        date: ref.date,
        starts_at: sydneyWallToUtc(ref.date, ref.startTime).toISOString(),
        status: "scheduled",
        origin: "recurring",
        duration_minutes:
          ref.durationMinutes > 0 ? Math.round(ref.durationMinutes) : enr.session_minutes,
        amount_cents: 0,
      })
      .select("id")
      .single();
    lessonId = (inserted as unknown as { id: string } | null)?.id ?? null;
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
}

/**
 * "Reschedule this week": strike the original occurrence (`rescheduled`, $0,
 * linked) and create a one-off MAKEUP at the new datetime inheriting the
 * enrollment's rate/duration. The recurrence rule is untouched; billing nets ONE
 * session (original $0 + makeup, which bills only once marked attended).
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

  // 1. Ensure the original is persisted and struck.
  let originalId = input.lessonId;
  let originalWasVirtual = false;
  if (originalId) {
    await supabase
      .from("lessons")
      .update({ status: "rescheduled", amount_cents: 0 })
      .eq("id", originalId);
  } else {
    originalWasVirtual = true;
    const { data: struck, error } = await supabase
      .from("lessons")
      .insert({
        tenant_id: enr.tenant_id,
        student_id: enr.student_id,
        enrollment_id: input.enrollmentId,
        date: input.date,
        starts_at: sydneyWallToUtc(input.date, input.startTime).toISOString(),
        status: "rescheduled",
        origin: "recurring",
        duration_minutes: duration,
        amount_cents: 0,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: "Couldn't strike the original." };
    originalId = (struck as unknown as { id: string }).id;
  }

  // 2. Create the one-off makeup (scheduled → bills only when marked attended).
  const { data: makeup, error: mkErr } = await supabase
    .from("lessons")
    .insert({
      tenant_id: enr.tenant_id,
      student_id: enr.student_id,
      enrollment_id: input.enrollmentId,
      date: input.newDate,
      starts_at: sydneyWallToUtc(input.newDate, input.newStartTime).toISOString(),
      status: "scheduled",
      origin: "makeup",
      duration_minutes: duration,
      amount_cents: 0,
    })
    .select("id")
    .single();
  if (mkErr) return { ok: false, error: "Couldn't create the makeup." };
  const makeupId = (makeup as unknown as { id: string }).id;

  // 3. Link original → makeup.
  await supabase
    .from("lessons")
    .update({ rescheduled_to_lesson_id: makeupId })
    .eq("id", originalId!);

  revalidatePath("/dashboard", "layout");
  return {
    ok: true,
    undo: { originalId: originalId!, originalWasVirtual, makeupId },
  };
}

/** Undo a reschedule: remove the makeup + un-strike (or delete) the original. */
export async function undoReschedule(u: RescheduleUndo): Promise<{ ok: boolean }> {
  if (!(await requireStaff())) return { ok: false };
  const supabase = await SB();
  await supabase.from("lessons").delete().eq("id", u.makeupId);
  if (u.originalWasVirtual) {
    await supabase.from("lessons").delete().eq("id", u.originalId);
  } else {
    await supabase
      .from("lessons")
      .update({ status: "scheduled", amount_cents: 0, rescheduled_to_lesson_id: null })
      .eq("id", u.originalId);
  }
  revalidatePath("/dashboard", "layout");
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
  const { error } = await supabase
    .from("enrollment_schedules")
    .update({ effective_to: sydneyNow().date })
    .eq("id", scheduleId);
  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}

/** Hard-delete a slot (added by mistake). Use endSchedule to preserve history. */
export async function deleteSchedule(scheduleId: string): Promise<{ ok: boolean }> {
  if (!(await requireStaff())) return { ok: false };
  if (!scheduleId) return { ok: false };
  const supabase = await SB();
  const { error } = await supabase
    .from("enrollment_schedules")
    .delete()
    .eq("id", scheduleId);
  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}
