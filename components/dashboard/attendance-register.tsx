"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  LESSON_STATUSES,
  blockAmountCents,
  formatDuration,
  formatMoney,
  modeLabel,
} from "@/lib/billing";
import {
  addSession,
  deleteLesson,
  markAttendance,
  restoreLesson,
  setLessonNote,
} from "@/lib/actions/attendance";
import type { EnrollmentMode, LessonStatus } from "@/lib/db/schema";

export interface RegisterLesson {
  lessonId: string;
  status: LessonStatus;
  amountCents: number;
  durationMinutes: number;
  note?: string | null;
}

export interface RegisterEnrollment {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  subjectName: string;
  mode: EnrollmentMode;
  hourlyRateCents: number;
  sessionMinutes: number;
  currency: string;
  canonical: RegisterLesson | null;
  extras: RegisterLesson[];
}

export interface RegisterGuard {
  studentId: string;
  studentName: string;
}

const LABEL: Record<LessonStatus, string> = {
  scheduled: "Scheduled",
  attended: "Attended",
  late: "Late",
  absent: "Absent",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
};

const ATTENDED = (s: LessonStatus) => s === "attended" || s === "late";

export function AttendanceRegister({
  date,
  enrollments,
  guards,
}: {
  date: string;
  enrollments: RegisterEnrollment[];
  guards: RegisterGuard[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const markedCount = enrollments.filter((e) => e.canonical !== null).length;
  const dayTotal = enrollments.reduce(
    (sum, e) =>
      sum +
      (e.canonical?.amountCents ?? 0) +
      e.extras.reduce((s, x) => s + x.amountCents, 0),
    0,
  );

  function mark(e: RegisterEnrollment, status: LessonStatus) {
    startTransition(async () => {
      const res = await markAttendance(e.enrollmentId, date, status);
      if (!res.ok || !res.lessonId) {
        toast.error("Couldn't save — try again");
        return;
      }
      const lessonId = res.lessonId;
      const prev = res.prev;
      toast.success(`${e.studentName} · ${e.subjectName} — ${LABEL[status]}`, {
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              await restoreLesson(lessonId, prev);
              router.refresh();
            }),
        },
      });
      router.refresh();
    });
  }

  function addAnother(e: RegisterEnrollment) {
    startTransition(async () => {
      const res = await addSession(e.enrollmentId, date, "attended");
      if (!res.ok || !res.lessonId) {
        toast.error("Couldn't add a session");
        return;
      }
      const lessonId = res.lessonId;
      toast.success(`Added a session for ${e.studentName}`, {
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              await deleteLesson(lessonId);
              router.refresh();
            }),
        },
      });
      router.refresh();
    });
  }

  function removeExtra(lessonId: string) {
    startTransition(async () => {
      await deleteLesson(lessonId);
      toast.success("Session removed");
      router.refresh();
    });
  }

  // Bulk "Mark all present" retired in Slice B.5 — the Calendar's mark-day /
  // mark-week is the one bulk engine (schedule-aware, future-guarded, batch
  // undo). This register stays for per-enrollment exceptions and extra sessions.

  return (
    <div>
      <div className="mt-5 flex items-center justify-between">
        <Link
          href="/dashboard/calendar"
          className="rounded-lg bg-brand-sage/15 px-4 py-2 text-sm font-medium text-brand-plum transition-colors hover:bg-brand-sage/25"
        >
          Bulk-mark on the Calendar →
        </Link>
        <span className="text-xs text-brand-ink/55">
          {markedCount} of {enrollments.length} marked
        </span>
      </div>

      {enrollments.length === 0 && guards.length === 0 ? (
        <p className="mt-6 text-sm text-brand-ink/60">
          No active enrollments yet. Add an enrollment on a student to bill them.
        </p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-2xl border border-brand-mist bg-white">
          <ul className="divide-y divide-brand-mist">
            {enrollments.map((e) => {
              const perSession = blockAmountCents(
                e.sessionMinutes,
                e.hourlyRateCents,
              );
              const status = e.canonical?.status ?? null;
              return (
                <li key={e.enrollmentId} className="px-5 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-brand-plum">
                        {e.studentName}
                        <span className="ml-2 text-sm text-brand-ink/60">
                          {e.subjectName}
                        </span>
                        <span className="ml-2 rounded-full bg-brand-sage/15 px-2 py-0.5 text-[11px] font-medium text-brand-plum">
                          {modeLabel(e.mode)}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-brand-ink/55">
                        {formatMoney(e.hourlyRateCents, e.currency)}/hr ·{" "}
                        {formatDuration(e.sessionMinutes)} →{" "}
                        {formatMoney(perSession, e.currency)}
                        {status !== null
                          ? ` · posted ${formatMoney(e.canonical?.amountCents ?? 0, e.currency)}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      {LESSON_STATUSES.map((st) => {
                        const active = status === st.value;
                        return (
                          <button
                            key={st.value}
                            type="button"
                            disabled={isPending}
                            onClick={() => mark(e, st.value)}
                            className={
                              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 " +
                              (active
                                ? "bg-brand-plum text-brand-cream"
                                : "border border-brand-mist text-brand-ink/70 hover:border-brand-plum/30 hover:bg-brand-plum/[0.04]")
                            }
                          >
                            {st.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Extra sessions (double / long class) */}
                  {e.extras.length > 0 ? (
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {e.extras.map((x) => (
                        <li
                          key={x.lessonId}
                          className="flex items-center justify-between rounded-lg bg-brand-cream/40 px-3 py-1.5 text-xs text-brand-ink/70"
                        >
                          <span>
                            Extra session · {formatDuration(x.durationMinutes)} ·{" "}
                            {LABEL[x.status]} ·{" "}
                            {formatMoney(x.amountCents, e.currency)}
                          </span>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => removeExtra(x.lessonId)}
                            className="text-brand-plum-mid hover:underline disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {/* Attended → note + add-another-session */}
                  {status !== null && ATTENDED(status) ? (
                    <div className="mt-3 flex flex-col gap-2">
                      {e.canonical ? (
                        <LessonNote
                          lessonId={e.canonical.lessonId}
                          initial={e.canonical.note ?? ""}
                        />
                      ) : null}
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => addAnother(e)}
                        className="self-start rounded-lg border border-dashed border-brand-mist px-3 py-1.5 text-xs text-brand-plum-mid hover:border-brand-plum/30 hover:bg-brand-plum/[0.03] disabled:opacity-50"
                      >
                        + Add another session (double / long class)
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}

            {/* Guard rows — active students with no enrollment */}
            {guards.map((g) => (
              <li
                key={g.studentId}
                className="flex items-center justify-between px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-brand-plum">{g.studentName}</p>
                  <p className="mt-0.5 text-xs text-brand-ink/55">
                    No enrollment — nothing to bill yet
                  </p>
                </div>
                <Link
                  href={`/dashboard/students/${g.studentId}`}
                  className="rounded-lg bg-brand-gold/15 px-3 py-1.5 text-xs font-medium text-brand-plum hover:bg-brand-gold/25"
                >
                  Add an enrollment →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end px-1 text-sm text-brand-ink/65">
        <span>
          Billed today:{" "}
          <span className="font-medium text-brand-plum">
            {formatMoney(dayTotal)}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * One-line "what we covered" for a marked lesson. Saves on blur (only when the
 * text changed) so it never nags. Fuel for the weekly parent note.
 */
function LessonNote({
  lessonId,
  initial,
}: {
  lessonId: string;
  initial: string;
}) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function save() {
    if (value.trim() === saved.trim()) return;
    startTransition(async () => {
      const res = await setLessonNote(lessonId, value);
      if (res.ok) {
        setSaved(value);
        toast.success("Saved", { duration: 1200 });
      } else {
        toast.error("Couldn't save the note");
      }
    });
  }

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      disabled={isPending}
      placeholder="What we covered (optional) — feeds the weekly parent note"
      className="block w-full rounded-lg border border-brand-mist bg-brand-cream/40 px-3 py-2 text-xs text-brand-ink/80 placeholder:text-brand-ink/40 focus:border-brand-plum/30 focus:bg-white focus:outline-none disabled:opacity-50"
    />
  );
}
