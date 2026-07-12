"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ENROLLMENT_MODES,
  blockAmountCents,
  formatDuration,
  formatMoney,
  modeLabel,
} from "@/lib/billing";
import {
  prettyTime,
  weekdayLong,
  WEEKDAY_ORDER,
} from "@/lib/calendar";
import {
  createEnrollment,
  setEnrollmentActive,
} from "@/lib/actions/enrollments";
import {
  addSchedule,
  endSchedule,
} from "@/lib/actions/calendar";
import type { EnrollmentMode } from "@/lib/db/schema";

export interface ScheduleSlotRow {
  id: string;
  weekday: number;
  startTime: string;
  durationOverride: number | null;
}

export interface EnrollmentRow {
  id: string;
  subjectName: string;
  mode: EnrollmentMode;
  hourlyRateCents: number;
  sessionMinutes: number;
  currency: string;
  active: boolean;
  schedules: ScheduleSlotRow[];
}

export interface SubjectOption {
  id: string;
  name: string;
}

/** Compact "$40/hr · 1.5h → $60/session" line. */
function rateLine(hourlyRateCents: number, sessionMinutes: number, currency: string) {
  const perSession = blockAmountCents(sessionMinutes, hourlyRateCents);
  return `${formatMoney(hourlyRateCents, currency)}/hr · ${formatDuration(
    sessionMinutes,
  )} → ${formatMoney(perSession, currency)}/session`;
}

export function EnrollmentsManager({
  studentId,
  subjects,
  enrollments,
  hasYearLevel,
}: {
  studentId: string;
  subjects: SubjectOption[];
  enrollments: EnrollmentRow[];
  hasYearLevel: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [mode, setMode] = useState<EnrollmentMode>("one_to_one");

  const active = enrollments.filter((e) => e.active);
  const inactive = enrollments.filter((e) => !e.active);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!subjectId) {
      toast.error("Pick a subject");
      return;
    }
    startTransition(async () => {
      const res = await createEnrollment({ studentId, subjectId, mode });
      if (res.ok) {
        toast.success("Enrollment added");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't add enrollment");
      }
    });
  }

  function toggle(id: string, next: boolean) {
    startTransition(async () => {
      const res = await setEnrollmentActive(id, next);
      if (res.ok) {
        toast.success(next ? "Enrollment reactivated" : "Enrollment ended");
        router.refresh();
      } else {
        toast.error("Couldn't update");
      }
    });
  }

  return (
    <section className="mt-8 rounded-2xl border border-brand-mist bg-white p-5">
      <h2 className="text-sm font-medium text-brand-plum">Enrollments</h2>

      {active.length === 0 ? (
        <p className="mt-3 rounded-lg bg-brand-gold/10 px-3 py-2 text-xs text-brand-plum">
          No enrollments yet — add one to bill this student.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-brand-mist rounded-xl border border-brand-mist">
          {active.map((en) => (
            <li key={en.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-plum">
                    {en.subjectName}
                    <span className="ml-2 rounded-full bg-brand-sage/15 px-2 py-0.5 text-[11px] font-medium text-brand-plum">
                      {modeLabel(en.mode)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-brand-ink/55">
                    {rateLine(en.hourlyRateCents, en.sessionMinutes, en.currency)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => toggle(en.id, false)}
                  className="shrink-0 rounded-lg border border-brand-mist px-3 py-1.5 text-xs text-brand-ink/70 hover:border-brand-plum/30 hover:bg-brand-plum/[0.04] disabled:opacity-50"
                >
                  End
                </button>
              </div>
              <ScheduleEditor
                enrollmentId={en.id}
                sessionMinutes={en.sessionMinutes}
                slots={en.schedules}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Add enrollment */}
      {subjects.length === 0 ? (
        <p className="mt-4 text-xs text-brand-ink/55">
          Add a subject and a price on the{" "}
          <Link href="/dashboard/pricing" className="underline">
            Pricing page
          </Link>{" "}
          first.
        </p>
      ) : !hasYearLevel ? (
        <p className="mt-4 text-xs text-brand-ink/55">
          Set the student&apos;s year level above — it picks the rate from the
          price list.
        </p>
      ) : (
        <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-brand-ink/60">
            Subject
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="mt-1 block rounded-lg border border-brand-mist bg-white px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-brand-ink/60">
            Mode
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as EnrollmentMode)}
              className="mt-1 block rounded-lg border border-brand-mist bg-white px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
            >
              {ENROLLMENT_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-brand-plum px-4 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid disabled:opacity-50"
          >
            Add enrollment
          </button>
        </form>
      )}
      <p className="mt-3 text-xs text-brand-ink/45">
        Each enrollment inherits its hourly rate and session length from the
        price list ({" "}
        <Link href="/dashboard/pricing" className="underline">
          edit rates
        </Link>{" "}
        ) by the student&apos;s year level.
      </p>

      {inactive.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-brand-plum-mid">
            {inactive.length} ended enrollment{inactive.length > 1 ? "s" : ""}
          </summary>
          <ul className="mt-2 divide-y divide-brand-mist rounded-xl border border-brand-mist">
            {inactive.map((en) => (
              <li
                key={en.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <p className="text-sm text-brand-ink/60">
                  {en.subjectName} · {modeLabel(en.mode)}
                </p>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => toggle(en.id, true)}
                  className="shrink-0 rounded-lg border border-brand-mist px-3 py-1.5 text-xs text-brand-ink/70 hover:border-brand-plum/30 disabled:opacity-50"
                >
                  Reactivate
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/**
 * The weekly-slot editor for one enrollment — the "change days from now on"
 * surface (doc 26 §2B). Adding a slot takes effect from today; ending a slot
 * end-dates it (past weeks still render). This is deliberately distinct from the
 * calendar's "reschedule this week" (a one-off makeup): here you change the
 * recurring pattern.
 */
function ScheduleEditor({
  enrollmentId,
  sessionMinutes,
  slots,
}: {
  enrollmentId: string;
  sessionMinutes: number;
  slots: ScheduleSlotRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [weekday, setWeekday] = useState(1); // Monday
  const [startTime, setStartTime] = useState("16:00");

  function add() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
      toast.error("Time must be HH:MM");
      return;
    }
    startTransition(async () => {
      const res = await addSchedule({ enrollmentId, weekday, startTime });
      if (res.ok) {
        toast.success("Weekly slot added — from now on");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't add the slot");
      }
    });
  }

  function end(id: string) {
    startTransition(async () => {
      const res = await endSchedule(id);
      if (res.ok) {
        toast.success("Slot ended from today");
        router.refresh();
      } else {
        toast.error("Couldn't end the slot");
      }
    });
  }

  return (
    <div className="mt-2.5 rounded-lg bg-brand-cream/40 px-3 py-2">
      {slots.length === 0 ? (
        <p className="text-xs text-brand-ink/55">
          No weekly time set — add one so it shows on the calendar.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {slots.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-1.5 rounded-full border border-brand-mist bg-white px-2.5 py-1 text-xs text-brand-plum"
            >
              <span>
                {weekdayLong(s.weekday)} {prettyTime(s.startTime)}
                {s.durationOverride ? ` · ${formatDuration(s.durationOverride)}` : ""}
              </span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => end(s.id)}
                className="text-brand-plum-mid hover:text-brand-plum disabled:opacity-50"
                title="End this slot from today"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-brand-ink/60">
            Day
            <select
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
              className="mt-1 block rounded-lg border border-brand-mist bg-white px-2 py-1 text-sm text-brand-plum focus:outline-none"
            >
              {WEEKDAY_ORDER.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.long}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-brand-ink/60">
            Time
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="mt-1 block rounded-lg border border-brand-mist bg-white px-2 py-1 text-sm text-brand-plum focus:outline-none"
            />
          </label>
          <button
            type="button"
            disabled={isPending}
            onClick={add}
            className="rounded-lg bg-brand-plum px-3 py-1.5 text-xs font-medium text-brand-cream hover:bg-brand-plum-mid disabled:opacity-50"
          >
            Add slot
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs text-brand-plum-mid hover:underline"
          >
            Cancel
          </button>
          <span className="text-[11px] text-brand-ink/45">
            Inherits {formatDuration(sessionMinutes)} from the rate.
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 text-xs text-brand-plum-mid hover:underline"
        >
          + Add a weekly time
        </button>
      )}
    </div>
  );
}
