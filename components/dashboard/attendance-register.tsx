"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatMoney, LESSON_STATUSES } from "@/lib/billing";
import {
  markAllPresent,
  markAttendance,
  restoreLesson,
} from "@/lib/actions/attendance";
import type { LessonStatus } from "@/lib/db/schema";

export interface RegisterStudent {
  id: string;
  name: string;
  rateCents: number;
  status: LessonStatus | null;
  postedCents: number | null;
}

const LABEL: Record<LessonStatus, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  cancelled: "Cancelled",
};

export function AttendanceRegister({
  date,
  students,
}: {
  date: string;
  students: RegisterStudent[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const markedCount = students.filter((s) => s.status !== null).length;
  const dayTotal = students.reduce((sum, s) => sum + (s.postedCents ?? 0), 0);

  function mark(s: RegisterStudent, status: LessonStatus) {
    startTransition(async () => {
      const res = await markAttendance(s.id, date, status);
      if (!res.ok) {
        toast.error("Couldn't save — try again");
        return;
      }
      toast.success(`${s.name} — ${LABEL[status]}`, {
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              await restoreLesson(s.id, date, res.prev);
              router.refresh();
            }),
        },
      });
      router.refresh();
    });
  }

  function markAll() {
    startTransition(async () => {
      const res = await markAllPresent(date);
      toast.success(
        res.count > 0
          ? `Marked ${res.count} present — adjust any exceptions below`
          : "Everyone's already marked",
      );
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mt-5 flex items-center justify-between">
        <button
          type="button"
          onClick={markAll}
          disabled={isPending}
          className="rounded-lg bg-brand-sage/15 px-4 py-2 text-sm font-medium text-brand-plum transition-colors hover:bg-brand-sage/25 disabled:opacity-50"
        >
          Mark all present
        </button>
        <span className="text-xs text-brand-ink/55">
          {markedCount} of {students.length} marked
        </span>
      </div>

      {students.length === 0 ? (
        <p className="mt-6 text-sm text-brand-ink/60">No active students yet.</p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-2xl border border-brand-mist bg-white">
          <ul className="divide-y divide-brand-mist">
            {students.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium text-brand-plum">{s.name}</p>
                  <p className="mt-0.5 text-xs text-brand-ink/55">
                    Rate {s.rateCents ? formatMoney(s.rateCents) : "— not set"}
                    {s.status !== null
                      ? ` · posted ${formatMoney(s.postedCents ?? 0)}`
                      : ""}
                  </p>
                </div>
                {s.rateCents === 0 ? (
                  <Link
                    href={`/dashboard/students/${s.id}`}
                    className="rounded-lg bg-brand-gold/15 px-3 py-1.5 text-xs font-medium text-brand-plum hover:bg-brand-gold/25"
                  >
                    Set a rate to mark →
                  </Link>
                ) : (
                  <div className="flex gap-1.5">
                    {LESSON_STATUSES.map((st) => {
                      const active = s.status === st.value;
                      return (
                        <button
                          key={st.value}
                          type="button"
                          disabled={isPending}
                          onClick={() => mark(s, st.value)}
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
                )}
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
