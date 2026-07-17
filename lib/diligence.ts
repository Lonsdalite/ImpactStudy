import type { AssignmentStatus } from "@/lib/db/schema";
import { reportWindow } from "@/lib/reports";
import { todaySydney } from "@/lib/billing";

/**
 * The parent-facing diligence signal (Slice D — doc 26 §2D).
 *
 * "Completion for the parent report = EFFORT, not score." This is the whole
 * point, and it is a product decision, not a data-modelling one:
 *
 *   - EFFORT is deterministic. "Completed 4 of 5 worksheets set this week" is
 *     countable, never wrong, and needs no AI — the same class of win as the
 *     attendance streak, and it lives in the "computed, never wrong" layer
 *     (doc 20 §7.1) rather than the generated one.
 *   - SCORE stays tutor-side and student-side. We never broadcast a child's low
 *     performance to their parent — that is the warmth thesis, and it is exactly
 *     why `corrections.items`/`stats` are unreachable to a parent at the DB
 *     (policies.sql §11d + the parent_corrections view).
 *
 * So this counts HANDED IN, and deliberately knows nothing about how the work
 * scored. A child who tried hard and got 3/18 reads identically to one who got
 * 18/18 — both did the work, which is the thing a parent can actually act on.
 *
 * Pure (no "server-only") so the report drafter, the parent view and the staff
 * board all compute it from ONE definition, the same discipline as lib/reports.ts.
 */

/** An assignment as diligence needs it. `createdAt` is when it was SET. */
export interface DiligenceAssignment {
  createdAt: string; // ISO timestamp
  status: AssignmentStatus;
}

export interface Diligence {
  /** Inclusive window [start, end] in YYYY-MM-DD (Sydney). */
  windowStart: string;
  windowEnd: string;
  /** Worksheets set in the window (excluding archived — withdrawn work isn't
   *  something the child failed to do). */
  set: number;
  /** Of those, how many have been handed in — any of submitted / corrected /
   *  returned. The child's job ends at handing in; whether Fatima has marked it
   *  yet is HER pipeline state, and must never read as the child's incompleteness. */
  completed: number;
}

/** Statuses that mean "the student handed it in". */
const HANDED_IN: AssignmentStatus[] = ["submitted", "corrected", "returned"];

/**
 * Count effort over the report window (Monday → today, Sydney — the same window
 * as the heartbeat, so a parent reads one consistent week).
 *
 * The window is over when the work was SET, not when it was handed in. That is
 * the honest reading of "of 5 assigned this week": the denominator is what she
 * asked for this week, and the numerator is how much of THAT came back. Work set
 * last week and handed in today counts toward last week's ask, where it belongs —
 * it would otherwise inflate this week past 100%.
 */
export function diligence(
  assignments: DiligenceAssignment[],
  todayIso: string = todaySydney(),
): Diligence {
  const { start, end } = reportWindow(todayIso);

  const inWindow = assignments.filter((a) => {
    if (a.status === "archived") return false;
    const day = a.createdAt.slice(0, 10); // ISO timestamp → YYYY-MM-DD
    return day >= start && day <= end;
  });

  return {
    windowStart: start,
    windowEnd: end,
    set: inWindow.length,
    completed: inWindow.filter((a) => HANDED_IN.includes(a.status)).length,
  };
}

/**
 * One honest line for a parent, or null when there is nothing to say.
 *
 * Returns null on `set === 0` rather than "0 of 0" — no homework set is not a
 * fact about the child, and padding the note with a non-event is how a heartbeat
 * starts feeling automated.
 *
 * The copy never praises or scolds: it states the count. "Completed 2 of 5" is
 * information a parent can act on; "only managed 2 of 5" is a judgement we
 * haven't earned and didn't measure.
 */
export function diligenceLine(d: Diligence, firstName: string): string | null {
  if (d.set === 0) return null;
  const word = d.set === 1 ? "worksheet" : "worksheets";
  if (d.completed === d.set) {
    return `${firstName} completed all ${d.set} ${word} set this week.`;
  }
  return `${firstName} completed ${d.completed} of ${d.set} ${word} set this week.`;
}
