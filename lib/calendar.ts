import type { EnrollmentMode, LessonOrigin, LessonStatus } from "@/lib/db/schema";
import { blockAmountCents, postedFee } from "@/lib/billing";

/**
 * Slice B — the VIRTUAL calendar engine (doc 26 §2B). Pure functions (no
 * "server-only") so the server page and client components share ONE source of
 * truth, exactly like lib/reports.ts and lib/billing.ts.
 *
 * The model: recurrence lives on `enrollment_schedules` (weekly slots). The
 * calendar RENDERS computed occurrences for a week; a `lessons` row is persisted
 * only when a slot is acted on (attendance / reschedule / note). A persisted row
 * OVERLAYS its computed occurrence (Google Calendar RECURRENCE-ID override) — so
 * editing the recurrence rule never clobbers marked history, and no future rows
 * are pre-generated.
 *
 * Timezone: the pilot tenant is Australia/Sydney. Dates are handled as calendar
 * dates (YYYY-MM-DD) and times as 'HH:MM' wall clock; the only real tz math is
 * `sydneyWallToUtc` (for the timestamptz `starts_at` snapshot) and `sydneyNow`
 * (for the "markable = at/earlier than now" guardrail).
 */

export const SYDNEY_TZ = "Australia/Sydney";

// ---------- date helpers (calendar-date arithmetic, tz-free) ----------

function isoToUTC(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function utcToIso(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}
export function addDaysIso(iso: string, n: number): string {
  const dt = isoToUTC(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return utcToIso(dt);
}
/** 0=Sunday .. 6=Saturday for a YYYY-MM-DD (matches JS Date.getUTCDay). */
export function weekdayOf(iso: string): number {
  return isoToUTC(iso).getUTCDay();
}

/** The Monday (YYYY-MM-DD) of the week containing `iso`. Weeks are Mon–Sun. */
export function weekStart(iso: string): string {
  const dow = weekdayOf(iso); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7; // Mon->0, Sun->6
  return addDaysIso(iso, -backToMonday);
}

/** The 7 dates Mon..Sun for the week whose Monday is `mondayIso`. */
export function weekDates(mondayIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(mondayIso, i));
}

// Display order Mon..Sun with 0=Sun..6=Sat weekday codes.
export const WEEKDAY_ORDER: { code: number; short: string; long: string }[] = [
  { code: 1, short: "Mon", long: "Monday" },
  { code: 2, short: "Tue", long: "Tuesday" },
  { code: 3, short: "Wed", long: "Wednesday" },
  { code: 4, short: "Thu", long: "Thursday" },
  { code: 5, short: "Fri", long: "Friday" },
  { code: 6, short: "Sat", long: "Saturday" },
  { code: 0, short: "Sun", long: "Sunday" },
];

export function weekdayLong(code: number): string {
  return WEEKDAY_ORDER.find((w) => w.code === code)?.long ?? "—";
}
export function weekdayShort(code: number): string {
  return WEEKDAY_ORDER.find((w) => w.code === code)?.short ?? "—";
}

/** "Mon 8 Jul" from YYYY-MM-DD. */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// ---------- time helpers ('HH:MM' wall clock) ----------

/** 'HH:MM' -> minutes since midnight. Returns 0 on garbage (defensive). */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = (hhmm ?? "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}
/** minutes since midnight -> 'HH:MM' (24h, zero-padded). */
export function minutesToTime(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
/** "4:00pm" from 'HH:MM'. */
export function prettyTime(hhmm: string): string {
  const mins = timeToMinutes(hhmm);
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, "0")}${ampm}`;
}
/** "4:00–5:00pm" style range from a start time + duration. */
export function timeRangeLabel(startHHMM: string, durationMinutes: number): string {
  const end = minutesToTime(timeToMinutes(startHHMM) + durationMinutes);
  return `${prettyTime(startHHMM)}–${prettyTime(end)}`;
}

// ---------- Sydney wall-clock ⇄ instant ----------

/** Now, as Sydney wall-clock parts { date: 'YYYY-MM-DD', time: 'HH:MM' }. */
export function sydneyNow(at: Date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SYDNEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`,
  };
}

/** The UTC offset (ms east of UTC) of a timezone at a given instant. */
function tzOffsetMs(tz: string, at: Date): number {
  const asUTC = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  const asTz = new Date(at.toLocaleString("en-US", { timeZone: tz }));
  return asTz.getTime() - asUTC.getTime();
}

/**
 * A Sydney wall time (date + 'HH:MM') -> the UTC instant it denotes, for the
 * timestamptz `starts_at` snapshot. Best-effort across DST (the ~1hr transition
 * window is not disambiguated — acceptable for a scheduling display value; all
 * marking/guardrail logic uses wall-clock string comparison, not this instant).
 */
export function sydneyWallToUtc(dateIso: string, hhmm: string): Date {
  const naive = Date.parse(`${dateIso}T${hhmm.length === 5 ? hhmm : "00:00"}:00Z`);
  const offset = tzOffsetMs(SYDNEY_TZ, new Date(naive));
  return new Date(naive - offset);
}

/** The Sydney wall-clock 'HH:MM' of a timestamptz value (or null). */
export function utcToSydneyTime(startsAt: string | Date | null): string | null {
  if (!startsAt) return null;
  const d = typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SYDNEY_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const h = get("hour") === "24" ? "00" : get("hour");
  return `${h}:${get("minute")}`;
}

/**
 * Markable guardrail (doc 26 §2B #1): only occurrences at/earlier than "now"
 * (Sydney) can be marked — never future. Compares wall clock, tz-math-free.
 */
export function isMarkable(
  dateIso: string,
  hhmm: string,
  now: { date: string; time: string } = sydneyNow(),
): boolean {
  if (dateIso < now.date) return true;
  if (dateIso > now.date) return false;
  return timeToMinutes(hhmm) <= timeToMinutes(now.time);
}

// ---------- occurrence model ----------

export interface ScheduleSlot {
  id: string;
  enrollmentId: string;
  weekday: number; // 0=Sun..6=Sat
  startTime: string; // 'HH:MM'
  durationOverride: number | null;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null;
  active: boolean;
}

export interface CalendarEnrollment {
  id: string;
  studentId: string;
  studentName: string;
  subjectName: string;
  mode: EnrollmentMode;
  hourlyRateCents: number;
  sessionMinutes: number;
  currency: string;
  active: boolean;
}

export interface CalendarLesson {
  id: string;
  enrollmentId: string | null;
  studentId: string;
  date: string; // YYYY-MM-DD
  startTime: string | null; // derived from starts_at (Sydney), or null (legacy)
  status: LessonStatus;
  origin: LessonOrigin;
  durationMinutes: number;
  amountCents: number;
  feeOverrideCents: number | null;
  note: string | null;
  rescheduledToLessonId: string | null;
}

export interface Occurrence {
  /** Stable key: persisted lesson id, or `v:enrollment:date:time` for a virtual. */
  key: string;
  lessonId: string | null; // null = virtual (not yet persisted)
  enrollmentId: string;
  studentId: string;
  studentName: string;
  subjectName: string;
  mode: EnrollmentMode;
  currency: string;
  hourlyRateCents: number;
  date: string; // YYYY-MM-DD
  startTime: string; // 'HH:MM'
  durationMinutes: number;
  status: LessonStatus;
  origin: LessonOrigin;
  note: string | null;
  /** Posted fee if persisted, else the fee this occurrence WOULD bill if attended. */
  amountCents: number;
  /** Per-lesson fee override (persisted rows only; null = derive from status). */
  feeOverrideCents: number | null;
  markable: boolean; // at/earlier than now
  rescheduledToLessonId: string | null;
}

function slotAppliesOn(slot: ScheduleSlot, dateIso: string): boolean {
  if (!slot.active) return false;
  if (weekdayOf(dateIso) !== slot.weekday) return false;
  if (dateIso < slot.effectiveFrom) return false;
  if (slot.effectiveTo && dateIso > slot.effectiveTo) return false;
  return true;
}

/**
 * Compute a week's occurrences: virtual occurrences from schedule slots, overlaid
 * by any persisted lessons (RECURRENCE-ID override), plus standalone makeup /
 * one-off lessons. Only ACTIVE enrollments generate virtual slots; a persisted
 * lesson on an inactive/ended enrollment still renders (history is never lost).
 */
export function computeWeekOccurrences(params: {
  dates: string[]; // the 7 week dates (Mon..Sun)
  enrollments: CalendarEnrollment[];
  slots: ScheduleSlot[];
  lessons: CalendarLesson[];
  now?: { date: string; time: string };
}): Occurrence[] {
  const { dates, enrollments, slots, lessons } = params;
  const now = params.now ?? sydneyNow();
  const dateSet = new Set(dates);
  const enrMap = new Map(enrollments.map((e) => [e.id, e]));

  // 1. Virtual occurrences from active schedule slots.
  //    Bucketed by enrollment+date so a persisted lesson can claim one.
  const virtualByDay = new Map<string, Occurrence[]>(); // key `${enr}|${date}`
  const out: Occurrence[] = [];

  for (const slot of slots) {
    const enr = enrMap.get(slot.enrollmentId);
    if (!enr || !enr.active) continue;
    for (const date of dates) {
      if (!slotAppliesOn(slot, date)) continue;
      const duration = slot.durationOverride ?? enr.sessionMinutes;
      const occ: Occurrence = {
        key: `v:${enr.id}:${date}:${slot.startTime}`,
        lessonId: null,
        enrollmentId: enr.id,
        studentId: enr.studentId,
        studentName: enr.studentName,
        subjectName: enr.subjectName,
        mode: enr.mode,
        currency: enr.currency,
        hourlyRateCents: enr.hourlyRateCents,
        date,
        startTime: slot.startTime,
        durationMinutes: duration,
        status: "scheduled",
        origin: "recurring",
        note: null,
        amountCents: blockAmountCents(duration, enr.hourlyRateCents),
        feeOverrideCents: null,
        markable: isMarkable(date, slot.startTime, now),
        rescheduledToLessonId: null,
      };
      const bucket = `${enr.id}|${date}`;
      const arr = virtualByDay.get(bucket) ?? [];
      arr.push(occ);
      virtualByDay.set(bucket, arr);
    }
  }

  // 2. Overlay persisted lessons.
  for (const l of lessons) {
    if (!dateSet.has(l.date)) continue;
    const enr = l.enrollmentId ? enrMap.get(l.enrollmentId) : undefined;

    // Standalone rows (makeup / one-off / no enrollment) always render as-is.
    if (l.origin !== "recurring" || !l.enrollmentId || !enr) {
      out.push(persistedToOccurrence(l, enr, now));
      continue;
    }

    // Recurring: claim the matching virtual occurrence for this enrollment+day.
    const bucket = `${l.enrollmentId}|${l.date}`;
    const candidates = virtualByDay.get(bucket) ?? [];
    let idx = -1;
    if (l.startTime) idx = candidates.findIndex((c) => c.startTime === l.startTime);
    if (idx === -1 && candidates.length > 0) idx = 0; // legacy/no-time → first slot
    if (idx >= 0) {
      const claimed = candidates[idx];
      candidates.splice(idx, 1);
      out.push(persistedToOccurrence(l, enr, now, claimed.startTime));
    } else {
      // Slot was end-dated but a marked lesson exists → keep it (history).
      out.push(persistedToOccurrence(l, enr, now));
    }
  }

  // 3. Remaining unclaimed virtuals.
  for (const arr of virtualByDay.values()) out.push(...arr);

  // 4. Sort: by date, then start time, then student name.
  out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      timeToMinutes(a.startTime) - timeToMinutes(b.startTime) ||
      a.studentName.localeCompare(b.studentName),
  );
  return out;
}

function persistedToOccurrence(
  l: CalendarLesson,
  enr: CalendarEnrollment | undefined,
  now: { date: string; time: string },
  fallbackTime?: string,
): Occurrence {
  const startTime = l.startTime ?? fallbackTime ?? "00:00";
  return {
    key: l.id,
    lessonId: l.id,
    enrollmentId: l.enrollmentId ?? "",
    studentId: l.studentId,
    studentName: enr?.studentName ?? "—",
    subjectName: enr?.subjectName ?? "—",
    mode: enr?.mode ?? "one_to_one",
    currency: enr?.currency ?? "AUD",
    hourlyRateCents: enr?.hourlyRateCents ?? 0,
    date: l.date,
    startTime,
    durationMinutes: l.durationMinutes,
    status: l.status,
    origin: l.origin,
    note: l.note,
    amountCents: l.amountCents,
    feeOverrideCents: l.feeOverrideCents,
    markable: isMarkable(l.date, startTime, now),
    rescheduledToLessonId: l.rescheduledToLessonId,
  };
}

// ---------- group visual-clustering (doc 26 §2B) ----------
// Enrollments sharing (date, start_time, subject, mode=group) render as ONE
// block. No real `class` entity yet (→ Stage 2). 1:1s and single-member groups
// render individually.

export type CalendarCell =
  | { kind: "single"; occ: Occurrence; key: string; startTime: string; durationMinutes: number }
  | {
      kind: "group";
      key: string;
      occs: Occurrence[];
      subjectName: string;
      startTime: string;
      durationMinutes: number;
      currency: string;
    };

/** Cluster ONE day's occurrences into cells (groups collapsed, 1:1s individual). */
export function clusterDay(dayOccurrences: Occurrence[]): CalendarCell[] {
  const groups = new Map<string, Occurrence[]>();
  const cells: CalendarCell[] = [];

  for (const occ of dayOccurrences) {
    if (occ.mode === "group") {
      const k = `${occ.startTime}|${occ.subjectName}`;
      const arr = groups.get(k) ?? [];
      arr.push(occ);
      groups.set(k, arr);
    } else {
      cells.push({
        kind: "single",
        occ,
        key: occ.key,
        startTime: occ.startTime,
        durationMinutes: occ.durationMinutes,
      });
    }
  }

  for (const [k, occs] of groups) {
    if (occs.length === 1) {
      cells.push({
        kind: "single",
        occ: occs[0],
        key: occs[0].key,
        startTime: occs[0].startTime,
        durationMinutes: occs[0].durationMinutes,
      });
    } else {
      cells.push({
        kind: "group",
        key: `g:${occs[0].date}:${k}`,
        occs,
        subjectName: occs[0].subjectName,
        startTime: occs[0].startTime,
        durationMinutes: Math.max(...occs.map((o) => o.durationMinutes)),
        currency: occs[0].currency,
      });
    }
  }

  cells.sort(
    (a, b) =>
      timeToMinutes(a.startTime) - timeToMinutes(b.startTime) ||
      a.key.localeCompare(b.key),
  );
  return cells;
}

// ---------- conflict detection (doc 26 §2B — warn, never block) ----------
// Two CELLS conflict if their time ranges overlap. A group cluster is one cell,
// so members within a group never conflict with each other (they legitimately
// share the slot); two 1:1s (or a 1:1 and a group, or two groups) overlapping =
// a real double-booking of the single teaching resource → surfaced loudly.

function cellRange(cell: CalendarCell): [number, number] {
  const start = timeToMinutes(cell.startTime);
  return [start, start + cell.durationMinutes];
}

/** Keys of cells that overlap another cell on the same day. */
export function conflictingCellKeys(cells: CalendarCell[]): Set<string> {
  const conflicts = new Set<string>();
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const [aStart, aEnd] = cellRange(cells[i]);
      const [bStart, bEnd] = cellRange(cells[j]);
      if (aStart < bEnd && bStart < aEnd) {
        conflicts.add(cells[i].key);
        conflicts.add(cells[j].key);
      }
    }
  }
  return conflicts;
}

// ---------- projected billing for a fee-preview (Slice A math, unchanged) ----------
/** What an occurrence WOULD post if marked attended — for the fee-preview line. */
export function projectedFee(occ: Occurrence): number {
  return postedFee(
    "attended",
    blockAmountCents(occ.durationMinutes, occ.hourlyRateCents),
    occ.feeOverrideCents,
  );
}
