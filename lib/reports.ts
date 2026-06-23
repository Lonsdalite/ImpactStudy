import type { LessonStatus } from "@/lib/db/schema";
import { todaySydney } from "@/lib/billing";

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
  attended: number; // present + late
  present: number;
  late: number;
  absent: number;
  cancelled: number;
  totalScheduled: number; // present + late + absent (cancelled excluded — not the student's doing)
  /** Sessions the student actually showed up to, newest first. */
  attendedSessions: { date: string; status: LessonStatus; note: string | null }[];
  /** Free-text notes left on this week's lessons, newest first. */
  notes: { date: string; note: string }[];
  /** Consecutive attended sessions ending at the most recent session (all-time). */
  streak: number;
}

const DAY_MS = 86_400_000;

function isoToUTC(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function utcToIso(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

/**
 * The reporting window: the `days`-day span ending today (Sydney), inclusive.
 * Default 7 = "this week". end is always today so the note reads as current.
 */
export function reportWindow(
  todayIso: string = todaySydney(),
  days = 7,
): { start: string; end: string } {
  const end = isoToUTC(todayIso);
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);
  return { start: utcToIso(start), end: todayIso };
}

const ATTENDED: LessonStatus[] = ["present", "late"];

/**
 * Compute the weekly summary from a student's lessons. `allLessons` may be the
 * student's full history (newest or any order); we slice the window ourselves
 * and use the full set only to compute the all-time attendance streak.
 */
export function weeklyStats(
  allLessons: ReportLesson[],
  todayIso: string = todaySydney(),
  days = 7,
): WeeklyStats {
  const { start, end } = reportWindow(todayIso, days);

  const inWindow = allLessons.filter((l) => l.date >= start && l.date <= end);

  let present = 0;
  let late = 0;
  let absent = 0;
  let cancelled = 0;
  for (const l of inWindow) {
    if (l.status === "present") present++;
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

  // All-time streak: walk lessons newest→oldest, count consecutive attended
  // until the first miss. cancelled rows don't break the streak (tutor's call).
  const chronological = [...allLessons].sort((a, b) => (a.date < b.date ? 1 : -1));
  let streak = 0;
  for (const l of chronological) {
    if (l.status === "cancelled") continue;
    if (ATTENDED.includes(l.status)) streak++;
    else break;
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
  const streakBit =
    stats.streak >= 3 ? ` ${stats.streak} in a row now.` : "";
  return `${firstName} showed up to ${stats.attended} ${sessionWord} this week.${streakBit}`;
}
