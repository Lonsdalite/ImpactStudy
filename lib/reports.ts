import type { LessonStatus } from "@/lib/db/schema";
import { todaySydney } from "@/lib/billing";
import { weekStart } from "@/lib/calendar";

/**
 * Parent-heartbeat report helpers. Pure functions (no "server-only") so both the
 * server action and server components can compute the same facts — and so the
 * deterministic "micro-win" card and the AI weekly note are driven by ONE source
 * of truth. The AI is only ever handed facts computed here; it never sees raw
 * rows and is told not to invent anything beyond them (anti-fabrication).
 */

/** A single lesson as we need it for reporting (RLS-scoped at the query). */
export interface ReportLesson {
  date: string; // YYYY-MM-DD
  status: LessonStatus;
  note: string | null;
}

export interface WeeklyStats {
  /** Inclusive window [start, end] in YYYY-MM-DD (Sydney). */
  windowStart: string;
  windowEnd: string;
  attended: number; // attended + late
  present: number; // count of `attended`-status sessions (kept name for callers)
  late: number;
  absent: number;
  cancelled: number;
  totalScheduled: number; // attended + late + absent (cancelled excluded — not the student's doing)
  /** Sessions the student actually showed up to, newest first. */
  attendedSessions: { date: string; status: LessonStatus; note: string | null }[];
  /** Free-text notes left on this week's lessons, newest first. */
  notes: { date: string; note: string }[];
  /**
   * All-time count of attended sessions (attended + late). NOT a consecutive
   * run — misses skip without breaking it (doc 26 §2B), so the copy says
   * "N sessions and counting", never "in a row".
   */
  streak: number;
}

/**
 * The reporting window: MONDAY of the week containing `todayIso` (Sydney)
 * through today, inclusive. Anchored to weekStart (Slice B.5) so the
 * unique(student_id, period_start) dedupe key is stable no matter which
 * weekday drafts run — the Friday cron and a mid-week manual "Draft this
 * week's notes" now hit the SAME row instead of minting an overlapping note.
 */
export function reportWindow(
  todayIso: string = todaySydney(),
): { start: string; end: string } {
  return { start: weekStart(todayIso), end: todayIso };
}

const ATTENDED: LessonStatus[] = ["attended", "late"];

/**
 * Compute the weekly summary from a student's lessons. `allLessons` may be the
 * student's full history (newest or any order); we slice the window ourselves
 * and use the full set only to compute the all-time attendance streak.
 */
export function weeklyStats(
  allLessons: ReportLesson[],
  todayIso: string = todaySydney(),
): WeeklyStats {
  const { start, end } = reportWindow(todayIso);

  const inWindow = allLessons.filter((l) => l.date >= start && l.date <= end);

  let present = 0;
  let late = 0;
  let absent = 0;
  let cancelled = 0;
  for (const l of inWindow) {
    if (l.status === "attended") present++;
    else if (l.status === "late") late++;
    else if (l.status === "absent") absent++;
    else if (l.status === "cancelled") cancelled++;
  }

  const attendedSessions = inWindow
    .filter((l) => ATTENDED.includes(l.status))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((l) => ({ date: l.date, status: l.status, note: l.note }));

  // Only notes from sessions the student actually attended — a leftover note on
  // an absent/cancelled day (e.g. from toggling status) must never feed the note.
  const notes = inWindow
    .filter(
      (l) => ATTENDED.includes(l.status) && l.note && l.note.trim().length > 0,
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((l) => ({ date: l.date, note: (l.note as string).trim() }));

  // All-time attended count (doc 26 §2B): attended/late sessions. A plain
  // missed session (absent/cancelled) is NOT counted but does NOT reset it —
  // this avoids punishing a legit holiday/sick week (protects the warmth
  // thesis). A `rescheduled` original is skipped too: its credit is carried by
  // the makeup lesson (which appears as its own attended row once marked).
  // Because misses never break it, this is a lifetime count, not a consecutive
  // run — the copy must never claim "in a row" (it lives in the "computed,
  // never wrong" layer, doc 20 §7.1). A true consecutive metric is a possible
  // later product decision (doc 35c Bucket C).
  let streak = 0;
  for (const l of allLessons) {
    if (ATTENDED.includes(l.status)) streak++;
    // absent / cancelled / rescheduled / scheduled → skip, never break.
  }

  return {
    windowStart: start,
    windowEnd: end,
    attended: present + late,
    present,
    late,
    absent,
    cancelled,
    totalScheduled: present + late + absent,
    attendedSessions,
    notes,
    streak,
  };
}

/**
 * One honest line for the deterministic "micro-win" card — no AI, no cost. Pure
 * function of the facts so it can never drift from reality.
 */
export function microWin(stats: WeeklyStats, firstName: string): string {
  if (stats.attended === 0) {
    if (stats.absent > 0) return `${firstName} missed this week's session.`;
    return `No sessions for ${firstName} this week yet.`;
  }
  const sessionWord = stats.attended === 1 ? "session" : "sessions";
  // "N sessions and counting" — truthful (streak = lifetime attended count;
  // misses don't break it, so it is NOT a consecutive run — never say "in a row").
  const streakBit =
    stats.streak >= 3 ? ` ${stats.streak} sessions and counting.` : "";
  return `${firstName} showed up to ${stats.attended} ${sessionWord} this week.${streakBit}`;
}
