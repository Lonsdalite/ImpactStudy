import "server-only";
import { createClient } from "@/lib/supabase/server";
import { utcToSydneyTime } from "@/lib/calendar";
import type {
  CalendarEnrollment,
  CalendarLesson,
  ScheduleSlot,
} from "@/lib/calendar";
import type { EnrollmentMode, LessonOrigin, LessonStatus } from "@/lib/db/schema";

/**
 * Server-only loader for a calendar week. Shared by the calendar page (render)
 * and the calendar server actions (guardrail-correct marking) so both compute
 * occurrences from the SAME data. Reads ride the RLS-enforced supabase-js path.
 *
 * We fetch ALL enrollments (active + inactive) so a persisted lesson on an ended
 * enrollment still resolves its student/subject; the engine only generates
 * virtual slots for active enrollments.
 */

interface EnrollmentQueryRow {
  id: string;
  student_id: string;
  mode: EnrollmentMode;
  hourly_rate_cents: number;
  session_minutes: number;
  currency: string;
  active: boolean;
  student: { first_name: string; last_name: string | null; active: boolean } | null;
  subject: { name: string } | null;
}
interface SlotQueryRow {
  id: string;
  enrollment_id: string;
  weekday: number;
  start_time: string;
  duration_override: number | null;
  effective_from: string;
  effective_to: string | null;
  active: boolean;
}
interface LessonQueryRow {
  id: string;
  enrollment_id: string | null;
  student_id: string;
  date: string;
  starts_at: string | null;
  status: LessonStatus;
  origin: LessonOrigin;
  duration_minutes: number;
  amount_cents: number;
  fee_override_cents: number | null;
  note: string | null;
  rescheduled_to_lesson_id: string | null;
}

export interface CalendarWeekData {
  enrollments: CalendarEnrollment[];
  slots: ScheduleSlot[];
  lessons: CalendarLesson[];
}

function fullName(s: { first_name: string; last_name: string | null } | null): string {
  if (!s) return "—";
  return `${s.first_name}${s.last_name ? ` ${s.last_name}` : ""}`;
}

export async function loadCalendarWeek(
  tenantId: string,
  dates: string[],
): Promise<CalendarWeekData> {
  const supabase = await createClient();
  const first = dates[0];
  const last = dates[dates.length - 1];

  const [{ data: enrollmentData }, { data: slotData }, { data: lessonData }] =
    await Promise.all([
      supabase
        .from("enrollments")
        .select(
          "id, student_id, mode, hourly_rate_cents, session_minutes, currency, active, student:students(first_name, last_name, active), subject:subjects(name)",
        )
        .eq("tenant_id", tenantId),
      supabase
        .from("enrollment_schedules")
        .select(
          "id, enrollment_id, weekday, start_time, duration_override, effective_from, effective_to, active",
        )
        .eq("tenant_id", tenantId),
      supabase
        .from("lessons")
        .select(
          "id, enrollment_id, student_id, date, starts_at, status, origin, duration_minutes, amount_cents, fee_override_cents, note, rescheduled_to_lesson_id",
        )
        .eq("tenant_id", tenantId)
        .gte("date", first)
        .lte("date", last),
    ]);

  const enrollmentRows = (enrollmentData ?? []) as unknown as EnrollmentQueryRow[];
  const slotRows = (slotData ?? []) as unknown as SlotQueryRow[];
  const lessonRows = (lessonData ?? []) as unknown as LessonQueryRow[];

  const enrollments: CalendarEnrollment[] = enrollmentRows.map((e) => ({
    id: e.id,
    studentId: e.student_id,
    studentName: fullName(e.student),
    subjectName: e.subject?.name ?? "—",
    mode: e.mode,
    hourlyRateCents: e.hourly_rate_cents,
    sessionMinutes: e.session_minutes,
    currency: e.currency,
    // Treat an enrollment on an inactive student as inactive (no new virtuals).
    active: e.active && e.student?.active !== false,
  }));

  const slots: ScheduleSlot[] = slotRows.map((s) => ({
    id: s.id,
    enrollmentId: s.enrollment_id,
    weekday: s.weekday,
    startTime: s.start_time,
    durationOverride: s.duration_override,
    effectiveFrom: s.effective_from,
    effectiveTo: s.effective_to,
    active: s.active,
  }));

  const lessons: CalendarLesson[] = lessonRows.map((l) => ({
    id: l.id,
    enrollmentId: l.enrollment_id,
    studentId: l.student_id,
    date: l.date,
    startTime: utcToSydneyTime(l.starts_at),
    status: l.status,
    origin: l.origin,
    durationMinutes: l.duration_minutes,
    amountCents: l.amount_cents,
    feeOverrideCents: l.fee_override_cents,
    note: l.note,
    rescheduledToLessonId: l.rescheduled_to_lesson_id,
  }));

  return { enrollments, slots, lessons };
}
