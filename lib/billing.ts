import type {
  BillingCycle,
  EnrollmentMode,
  LessonStatus,
} from "@/lib/db/schema";

/**
 * Attendance-driven billing helpers. Pure functions (no server-only) so both
 * server components and the client can format money consistently.
 *
 * Slice A billing (doc 26 §2 / doc 27 §2.5): a lesson posts a fee snapshotted at
 * mark time = round(duration_minutes / 60 × hourly_rate_cents), gated by status:
 *   present / late     -> hours × rate
 *   absent / cancelled -> 0
 * "Late" charging full is a deliberate default; make it configurable later.
 */

/** The dollars-in-cents value of a billed block: round(minutes/60 × hourlyRate). */
export function blockAmountCents(
  durationMinutes: number,
  hourlyRateCents: number,
): number {
  if (!Number.isFinite(durationMinutes) || !Number.isFinite(hourlyRateCents)) {
    return 0;
  }
  return Math.round((durationMinutes / 60) * hourlyRateCents);
}

/**
 * The fee posted for a lesson: the block value when the student showed up,
 * zero when they didn't. `blockCents` = blockAmountCents(duration, rate).
 */
export function feeForStatus(status: LessonStatus, blockCents: number): number {
  switch (status) {
    case "present":
    case "late":
      return blockCents;
    case "absent":
    case "cancelled":
      return 0;
    default:
      return 0;
  }
}

// ---------- enrollment mode + session length ----------

const MODE_LABEL: Record<EnrollmentMode, string> = {
  one_to_one: "1:1",
  group: "Group",
};
export function modeLabel(mode: EnrollmentMode): string {
  return MODE_LABEL[mode];
}

export const ENROLLMENT_MODES: { value: EnrollmentMode; label: string }[] = [
  { value: "one_to_one", label: "1:1" },
  { value: "group", label: "Group" },
];

/**
 * The mode-based default session length (minutes): 1:1 → 60, group → 90. NOT
 * hardcoded into the schema — it seeds the price-list row's editable value so
 * other tenants and one-off long classes need no code change (doc 26 §2).
 */
export function defaultSessionMinutes(mode: EnrollmentMode): number {
  return mode === "group" ? 90 : 60;
}

/** "1.5h" / "1h" / "45 min" from minutes, for compact rate lines. */
export function formatDuration(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  if (minutes > 60) return `${(minutes / 60).toFixed(1)}h`;
  return `${minutes} min`;
}

export function formatMoney(cents: number, currency = "AUD"): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export const LESSON_STATUSES: {
  value: LessonStatus;
  label: string;
}[] = [
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "absent", label: "Absent" },
  { value: "cancelled", label: "Cancelled" },
];

/** First and last day (YYYY-MM-DD) of the month containing `isoDate`. */
export function monthBounds(isoDate: string): { start: string; end: string } {
  const [y, m] = isoDate.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

/** Today as YYYY-MM-DD (Australia/Sydney — the pilot tenant's timezone). */
export function todaySydney(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
}

/** Human month label, e.g. "June 2026", from a YYYY-MM or YYYY-MM-DD string. */
export function monthLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ---------- per-student billing cycles ----------

const CYCLE_LABEL: Record<BillingCycle, string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
};
export function cycleLabel(cycle: BillingCycle): string {
  return CYCLE_LABEL[cycle];
}

export const BILLING_CYCLES: { value: BillingCycle; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "fortnightly", label: "Fortnightly" },
  { value: "monthly", label: "Monthly" },
];

function isoToUTC(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function utcToIso(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}
function addDaysIso(iso: string, n: number): string {
  const dt = isoToUTC(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return utcToIso(dt);
}
function daysBetween(aIso: string, bIso: string): number {
  return Math.round(
    (isoToUTC(bIso).getTime() - isoToUTC(aIso).getTime()) / 86400000,
  );
}

/**
 * The billing period (inclusive [start, end]) that contains `todayIso`, tiled
 * from the student's anchor date. Arrears model: the period's fees are due at
 * its end. weekly = 7 days, fortnightly = 14, monthly = anchor-day to anchor-day.
 */
export function currentPeriod(
  cycle: BillingCycle,
  anchorIso: string,
  todayIso: string,
): { start: string; end: string } {
  if (cycle === "weekly" || cycle === "fortnightly") {
    const len = cycle === "weekly" ? 7 : 14;
    const diff = daysBetween(anchorIso, todayIso);
    if (diff < 0) return { start: anchorIso, end: addDaysIso(anchorIso, len - 1) };
    const start = addDaysIso(anchorIso, Math.floor(diff / len) * len);
    return { start, end: addDaysIso(start, len - 1) };
  }

  // monthly: from the anchor day-of-month (clamped to month length).
  const anchorDay = isoToUTC(anchorIso).getUTCDate();
  const t = isoToUTC(todayIso);
  const monthStart = (year: number, monthIndex: number) => {
    const dim = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, monthIndex, Math.min(anchorDay, dim)));
  };
  let start = monthStart(t.getUTCFullYear(), t.getUTCMonth());
  if (t.getTime() < start.getTime()) {
    start = monthStart(t.getUTCFullYear(), t.getUTCMonth() - 1);
  }
  const next = monthStart(start.getUTCFullYear(), start.getUTCMonth() + 1);
  return {
    start: utcToIso(start),
    end: utcToIso(new Date(next.getTime() - 86400000)),
  };
}

/** Next collection date = end of the current period (arrears). */
export function nextCollection(
  cycle: BillingCycle,
  anchorIso: string,
  todayIso: string,
): string {
  return currentPeriod(cycle, anchorIso, todayIso).end;
}

/** "today" / "in 3 days" / "5 days ago" relative to today. */
export function relativeDay(targetIso: string, todayIso: string): string {
  const n = daysBetween(todayIso, targetIso);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** Date label like "Thu, 18 Jun" from YYYY-MM-DD. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
