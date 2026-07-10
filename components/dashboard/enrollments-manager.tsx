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
  createEnrollment,
  setEnrollmentActive,
} from "@/lib/actions/enrollments";
import type { EnrollmentMode } from "@/lib/db/schema";

export interface EnrollmentRow {
  id: string;
  subjectName: string;
  mode: EnrollmentMode;
  hourlyRateCents: number;
  sessionMinutes: number;
  currency: string;
  active: boolean;
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
            <li
              key={en.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
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
