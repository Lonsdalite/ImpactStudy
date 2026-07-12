"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  clusterDay,
  conflictingCellKeys,
  prettyTime,
  timeRangeLabel,
  projectedFee,
  type CalendarCell,
  type Occurrence,
} from "@/lib/calendar";
import {
  formatDuration,
  formatMoney,
  isAttended,
  LESSON_STATUSES,
  LESSON_STATUS_LABEL,
  modeLabel,
} from "@/lib/billing";
import {
  markDayAttended,
  markWeekAttended,
  rescheduleOccurrence,
  restoreOccurrence,
  setOccurrenceNote,
  setOccurrenceStatus,
  undoMark,
  undoReschedule,
  type OccurrenceRef,
} from "@/lib/actions/calendar";
import type { LessonStatus } from "@/lib/db/schema";

export interface CalendarStudent {
  id: string;
  name: string;
}

const firstName = (n: string) => n.split(" ")[0];

function refOf(o: Occurrence): OccurrenceRef {
  return {
    lessonId: o.lessonId,
    enrollmentId: o.enrollmentId,
    date: o.date,
    startTime: o.startTime,
    durationMinutes: o.durationMinutes,
  };
}

// status → pill classes
const PILL: Record<LessonStatus, string> = {
  scheduled: "bg-brand-mist/60 text-brand-ink/60",
  attended: "bg-brand-sage/20 text-brand-plum",
  late: "bg-brand-gold/25 text-brand-plum",
  absent: "bg-brand-ink/10 text-brand-ink/55",
  cancelled: "bg-brand-ink/10 text-brand-ink/45",
  rescheduled: "bg-brand-plum/10 text-brand-plum-mid line-through",
};

export function WeeklyCalendar({
  monday,
  dates,
  today,
  occurrences,
  students,
  dayLabels,
}: {
  monday: string;
  dates: string[];
  today: string;
  occurrences: Occurrence[];
  students: CalendarStudent[];
  dayLabels: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [studentId, setStudentId] = useState("");
  const [drawerDay, setDrawerDay] = useState<string | null>(null);
  const [reschedule, setReschedule] = useState<Occurrence | null>(null);

  // Changing weeks doesn't unmount this component (same route), so a day drawer /
  // reschedule modal opened on the previous week would linger showing a date that
  // isn't in the new week. Rather than reset state in an effect, we derive what's
  // actually showable: only render the drawer/modal if their date is in view.
  const shownDrawerDay = drawerDay && dates.includes(drawerDay) ? drawerDay : null;
  const shownReschedule =
    reschedule && dates.includes(reschedule.date) ? reschedule : null;

  const filtered = useMemo(
    () => (studentId ? occurrences.filter((o) => o.studentId === studentId) : occurrences),
    [occurrences, studentId],
  );

  const perDay = useMemo(
    () =>
      dates.map((d) => {
        const dayOccs = filtered.filter((o) => o.date === d);
        const cells = clusterDay(dayOccs);
        const conflicts = conflictingCellKeys(cells);
        const markable = dayOccs.filter((o) => o.status === "scheduled" && o.markable).length;
        const posted = dayOccs
          .filter((o) => isAttended(o.status))
          .reduce((s, o) => s + o.amountCents, 0);
        return { date: d, dayOccs, cells, conflicts, markable, posted };
      }),
    [dates, filtered],
  );

  const weekMarkable = useMemo(
    () => filtered.filter((o) => o.status === "scheduled" && o.markable).length,
    [filtered],
  );
  const weekPosted = useMemo(
    () => filtered.filter((o) => isAttended(o.status)).reduce((s, o) => s + o.amountCents, 0),
    [filtered],
  );

  function doMarkWeek() {
    startTransition(async () => {
      const res = await markWeekAttended(monday);
      if (!res.ok) {
        toast.error("Couldn't mark the week");
        return;
      }
      if (res.count === 0) {
        toast.success("Nothing left to mark this week");
      } else {
        const reverts = res.reverts;
        toast.success(`Marked ${res.count} attended this week`, {
          action: {
            label: "Undo all",
            onClick: () =>
              startTransition(async () => {
                await undoMark(reverts);
                router.refresh();
              }),
          },
        });
      }
      router.refresh();
    });
  }

  function doMarkDay(date: string) {
    startTransition(async () => {
      const res = await markDayAttended(date);
      if (!res.ok) {
        toast.error("Couldn't mark the day");
        return;
      }
      if (res.count === 0) {
        toast.success("Nothing to mark that day");
      } else {
        const reverts = res.reverts;
        toast.success(`Marked ${res.count} attended`, {
          action: {
            label: "Undo all",
            onClick: () =>
              startTransition(async () => {
                await undoMark(reverts);
                router.refresh();
              }),
          },
        });
      }
      router.refresh();
    });
  }

  function setStatus(o: Occurrence, status: LessonStatus) {
    startTransition(async () => {
      const res = await setOccurrenceStatus(refOf(o), status);
      if (!res.ok || !res.lessonId) {
        toast.error("Couldn't save");
        return;
      }
      const { lessonId, prev } = res;
      toast.success(`${firstName(o.studentName)} · ${o.subjectName} — ${LESSON_STATUS_LABEL[status]}`, {
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              await restoreOccurrence(lessonId, prev);
              router.refresh();
            }),
        },
      });
      router.refresh();
    });
  }

  function confirmReschedule(o: Occurrence, newDate: string, newTime: string) {
    startTransition(async () => {
      const res = await rescheduleOccurrence({
        lessonId: o.lessonId,
        enrollmentId: o.enrollmentId,
        date: o.date,
        startTime: o.startTime,
        durationMinutes: o.durationMinutes,
        newDate,
        newStartTime: newTime,
      });
      if (!res.ok || !res.undo) {
        toast.error(res.error ?? "Couldn't reschedule");
        return;
      }
      const undo = res.undo;
      setReschedule(null);
      toast.success(`Rescheduled ${firstName(o.studentName)} to a makeup`, {
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              await undoReschedule(undo);
              router.refresh();
            }),
        },
      });
      router.refresh();
    });
  }

  return (
    <div className="mt-5">
      {/* Action row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={doMarkWeek}
            disabled={isPending || weekMarkable === 0}
            className="rounded-lg bg-brand-sage/15 px-4 py-2 text-sm font-medium text-brand-plum transition-colors hover:bg-brand-sage/25 disabled:opacity-50"
          >
            Mark this week{weekMarkable > 0 ? ` (${weekMarkable})` : ""}
          </button>
          {students.length > 0 ? (
            <label className="text-xs text-brand-ink/55">
              <select
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="rounded-lg border border-brand-mist bg-white px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
              >
                <option value="">All students</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <span className="text-sm text-brand-ink/65">
          Billed this week:{" "}
          <span className="font-medium text-brand-plum">{formatMoney(weekPosted)}</span>
        </span>
      </div>

      {/* Week grid */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {perDay.map((day, i) => {
          const isToday = day.date === today;
          return (
            <div
              key={day.date}
              className={
                "flex min-h-[7rem] flex-col rounded-xl border bg-white p-2 " +
                (isToday ? "border-brand-plum/40 ring-1 ring-brand-plum/20" : "border-brand-mist")
              }
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className={"text-xs font-medium " + (isToday ? "text-brand-plum" : "text-brand-ink/60")}>
                  {dayLabels[i]}
                </span>
                {day.markable > 0 ? (
                  <button
                    type="button"
                    onClick={() => doMarkDay(day.date)}
                    disabled={isPending}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium text-brand-plum-mid hover:bg-brand-sage/15 disabled:opacity-50"
                    title="Mark this day attended"
                  >
                    Mark {day.markable}
                  </button>
                ) : null}
              </div>

              <div className="flex flex-1 flex-col gap-1.5">
                {day.cells.length === 0 ? (
                  <span className="text-[11px] text-brand-ink/35">—</span>
                ) : (
                  day.cells.map((cell) => (
                    <CellChip
                      key={cell.key}
                      cell={cell}
                      conflict={day.conflicts.has(cell.key)}
                    />
                  ))
                )}
              </div>

              {day.dayOccs.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setDrawerDay(day.date)}
                  className="mt-1.5 rounded px-1 py-0.5 text-left text-[10px] text-brand-plum-mid hover:underline"
                >
                  Open day →{day.posted > 0 ? ` ${formatMoney(day.posted)}` : ""}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Per-day register drawer */}
      {shownDrawerDay ? (
        <DayDrawer
          label={dayLabels[dates.indexOf(shownDrawerDay)] ?? shownDrawerDay}
          occurrences={filtered.filter((o) => o.date === shownDrawerDay)}
          isPending={isPending}
          onClose={() => setDrawerDay(null)}
          onMarkDay={() => doMarkDay(shownDrawerDay)}
          onStatus={setStatus}
          onReschedule={(o) => setReschedule(o)}
          onNoteSaved={() => router.refresh()}
        />
      ) : null}

      {/* Reschedule modal */}
      {shownReschedule ? (
        <RescheduleModal
          occ={shownReschedule}
          isPending={isPending}
          onCancel={() => setReschedule(null)}
          onConfirm={(d, t) => confirmReschedule(shownReschedule, d, t)}
        />
      ) : null}
    </div>
  );
}

// ---------- a single grid chip (single occurrence or group cluster) ----------

function CellChip({ cell, conflict }: { cell: CalendarCell; conflict: boolean }) {
  const ring = conflict ? "ring-1 ring-brand-gold/70" : "";
  if (cell.kind === "group") {
    return (
      <div className={`rounded-lg bg-brand-plum/[0.04] px-2 py-1 ${ring}`} title="Group class">
        <p className="text-[11px] font-medium text-brand-plum">
          {prettyTime(cell.startTime)} · {cell.subjectName}
        </p>
        <p className="text-[10px] text-brand-ink/55">
          Group ({cell.occs.length}): {cell.occs.map((o) => firstName(o.studentName)).join(", ")}
        </p>
        {conflict ? <p className="text-[10px] text-brand-gold">Overlaps another class</p> : null}
      </div>
    );
  }
  const o = cell.occ;
  return (
    <div className={`rounded-lg px-2 py-1 ${PILL[o.status]} ${ring}`}>
      <p className="text-[11px] font-medium">
        {prettyTime(o.startTime)} · {firstName(o.studentName)}
      </p>
      <p className="text-[10px] opacity-80">
        {o.subjectName}
        {o.origin === "makeup" ? " · Makeup" : ""}
        {o.status !== "scheduled" ? ` · ${LESSON_STATUS_LABEL[o.status]}` : ""}
      </p>
      {conflict ? <p className="text-[10px] text-brand-gold">Overlaps</p> : null}
    </div>
  );
}

// ---------- per-day register drawer ----------

function DayDrawer({
  label,
  occurrences,
  isPending,
  onClose,
  onMarkDay,
  onStatus,
  onReschedule,
  onNoteSaved,
}: {
  label: string;
  occurrences: Occurrence[];
  isPending: boolean;
  onClose: () => void;
  onMarkDay: () => void;
  onStatus: (o: Occurrence, s: LessonStatus) => void;
  onReschedule: (o: Occurrence) => void;
  onNoteSaved: () => void;
}) {
  const sorted = [...occurrences].sort((a, b) =>
    a.startTime.localeCompare(b.startTime) || a.studentName.localeCompare(b.studentName),
  );
  const markable = sorted.filter((o) => o.status === "scheduled" && o.markable).length;

  return (
    <div className="mt-5 rounded-2xl border border-brand-mist bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-brand-plum">{label}</h2>
        <div className="flex items-center gap-3">
          {markable > 0 ? (
            <button
              type="button"
              onClick={onMarkDay}
              disabled={isPending}
              className="rounded-lg bg-brand-sage/15 px-3 py-1.5 text-xs font-medium text-brand-plum hover:bg-brand-sage/25 disabled:opacity-50"
            >
              Mark day ({markable})
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-brand-plum-mid hover:underline"
          >
            Close
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="mt-3 text-sm text-brand-ink/60">Nothing scheduled.</p>
      ) : (
        <ul className="mt-3 divide-y divide-brand-mist">
          {sorted.map((o) => (
            <OccurrenceRow
              key={o.key}
              o={o}
              isPending={isPending}
              onStatus={onStatus}
              onReschedule={onReschedule}
              onNoteSaved={onNoteSaved}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function OccurrenceRow({
  o,
  isPending,
  onStatus,
  onReschedule,
  onNoteSaved,
}: {
  o: Occurrence;
  isPending: boolean;
  onStatus: (o: Occurrence, s: LessonStatus) => void;
  onReschedule: (o: Occurrence) => void;
  onNoteSaved: () => void;
}) {
  const isResolved = o.status === "rescheduled";
  const showNote = isAttended(o.status);
  const feeLine =
    o.status === "scheduled"
      ? `will bill ${formatMoney(projectedFee(o), o.currency)}`
      : isAttended(o.status)
        ? `posted ${formatMoney(o.amountCents, o.currency)}`
        : formatMoney(0, o.currency);

  return (
    <li className="py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-brand-plum">
            {o.studentName}
            <span className="ml-2 text-xs text-brand-ink/60">{o.subjectName}</span>
            <span className="ml-2 rounded-full bg-brand-sage/15 px-2 py-0.5 text-[11px] font-medium text-brand-plum">
              {modeLabel(o.mode)}
            </span>
            {o.origin === "makeup" ? (
              <span className="ml-2 rounded-full bg-brand-plum/10 px-2 py-0.5 text-[11px] font-medium text-brand-plum-mid">
                Makeup
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-brand-ink/55">
            {timeRangeLabel(o.startTime, o.durationMinutes)} · {formatDuration(o.durationMinutes)} ·{" "}
            {feeLine}
            {!o.markable && o.status === "scheduled" ? " · upcoming" : ""}
          </p>
        </div>
        {isResolved ? (
          <span className="shrink-0 text-xs text-brand-plum-mid">
            Rescheduled → makeup
          </span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {LESSON_STATUSES.map((st) => {
              const active = o.status === st.value;
              const disabled = isPending || (!o.markable && st.value !== "cancelled");
              return (
                <button
                  key={st.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => onStatus(o, st.value)}
                  className={
                    "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 " +
                    (active
                      ? "bg-brand-plum text-brand-cream"
                      : "border border-brand-mist text-brand-ink/70 hover:border-brand-plum/30 hover:bg-brand-plum/[0.04]")
                  }
                >
                  {st.label}
                </button>
              );
            })}
            <button
              type="button"
              disabled={isPending}
              onClick={() => onReschedule(o)}
              className="rounded-lg border border-dashed border-brand-mist px-2.5 py-1.5 text-xs text-brand-plum-mid hover:border-brand-plum/30 hover:bg-brand-plum/[0.03] disabled:opacity-50"
            >
              Reschedule
            </button>
          </div>
        )}
      </div>

      {showNote ? (
        <OccurrenceNote occ={o} onSaved={onNoteSaved} />
      ) : null}
    </li>
  );
}

function OccurrenceNote({ occ, onSaved }: { occ: Occurrence; onSaved: () => void }) {
  const [value, setValue] = useState(occ.note ?? "");
  const [saved, setSaved] = useState(occ.note ?? "");
  const [isPending, startTransition] = useTransition();

  function save() {
    if (value.trim() === saved.trim()) return;
    startTransition(async () => {
      const res = await setOccurrenceNote(refOf(occ), value);
      if (res.ok) {
        setSaved(value);
        toast.success("Saved", { duration: 1200 });
        onSaved();
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
      className="mt-2 block w-full rounded-lg border border-brand-mist bg-brand-cream/40 px-3 py-2 text-xs text-brand-ink/80 placeholder:text-brand-ink/40 focus:border-brand-plum/30 focus:bg-white focus:outline-none disabled:opacity-50"
    />
  );
}

// ---------- reschedule modal ----------

function RescheduleModal({
  occ,
  isPending,
  onCancel,
  onConfirm,
}: {
  occ: Occurrence;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (newDate: string, newTime: string) => void;
}) {
  const [newDate, setNewDate] = useState(occ.date);
  const [newTime, setNewTime] = useState(occ.startTime);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-brand-mist bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl text-brand-plum">Reschedule this week</h2>
        <p className="mt-2 text-xs leading-relaxed text-brand-ink/60">
          Moves <span className="font-medium text-brand-plum">{firstName(occ.studentName)}</span>
          &apos;s {occ.subjectName}{" "}to a one-off makeup. The original is struck (no
          charge) and the makeup carries the fee — so it&apos;s still one billed
          session. Your recurring days don&apos;t change; to change the weekly
          pattern, edit the enrollment on the student&apos;s page.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <label className="text-xs text-brand-ink/60">
            New date
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="mt-1 block rounded-lg border border-brand-mist bg-white px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
            />
          </label>
          <label className="text-xs text-brand-ink/60">
            New time
            <input
              type="time"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="mt-1 block rounded-lg border border-brand-mist bg-white px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-brand-mist px-4 py-2 text-sm text-brand-ink/70 hover:bg-brand-plum/[0.04]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending || !newDate || !newTime}
            onClick={() => onConfirm(newDate, newTime)}
            className="rounded-lg bg-brand-plum px-4 py-2 text-sm font-medium text-brand-cream hover:bg-brand-plum-mid disabled:opacity-50"
          >
            Reschedule
          </button>
        </div>
      </div>
    </div>
  );
}
