"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createAssignment,
  moveAssignmentUpNext,
  setAssignmentStatus,
} from "@/lib/actions/homework";
import { ASSIGNMENT_STATUS_LABEL, assignmentStatusChip } from "@/lib/homework";
import { shortDate } from "@/lib/billing";
import type { AssignmentStatus } from "@/lib/db/schema";

export interface TrackerAssignment {
  id: string;
  title: string;
  status: AssignmentStatus;
  subjectName: string | null;
  dueDate: string | null;
  orderIndex: number;
}
export interface TrackerWorksheet {
  id: string;
  title: string;
}

export function AssignmentTracker({
  studentId,
  worksheets,
  assignments,
}: {
  studentId: string;
  worksheets: TrackerWorksheet[];
  assignments: TrackerAssignment[];
}) {
  const router = useRouter();
  const [worksheetId, setWorksheetId] = useState("");
  const [title, setTitle] = useState("");
  const [isPending, startTransition] = useTransition();

  const open = assignments.filter(
    (a) => a.status !== "returned" && a.status !== "archived",
  );
  const done = assignments.filter((a) => a.status === "returned");
  // "Up next" = the open assignment with the lowest order (tie → first listed).
  const upNextId = open
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)[0]?.id;

  function add() {
    if (!worksheetId && !title.trim()) {
      toast.error("Pick a worksheet or type a title");
      return;
    }
    startTransition(async () => {
      const res = await createAssignment({
        studentId,
        worksheetId: worksheetId || null,
        title: title.trim() || null,
      });
      if (res.ok) {
        toast.success("Assigned");
        setTitle("");
        setWorksheetId("");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't assign");
      }
    });
  }

  function upNext(id: string) {
    startTransition(async () => {
      const res = await moveAssignmentUpNext(id);
      if (res.ok) {
        toast.success("Moved to up next");
        router.refresh();
      } else {
        toast.error("Couldn't move");
      }
    });
  }

  function archive(id: string) {
    startTransition(async () => {
      const res = await setAssignmentStatus(id, "archived");
      if (res.ok) {
        toast.success("Archived");
        router.refresh();
      } else {
        toast.error("Couldn't archive");
      }
    });
  }

  return (
    <section className="mt-8 rounded-2xl border border-brand-mist bg-white p-5">
      <h2 className="text-sm font-medium text-brand-plum">Homework</h2>

      {open.length === 0 ? (
        <p className="mt-3 rounded-lg bg-brand-gold/10 px-3 py-2 text-xs text-brand-plum">
          Nothing assigned right now.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-brand-mist rounded-xl border border-brand-mist">
          {open.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-brand-plum">
                  <span className="truncate">{a.title}</span>
                  {a.id === upNextId ? (
                    <span className="shrink-0 rounded-full bg-brand-plum px-2 py-0.5 text-[10px] font-medium text-brand-cream">
                      Up next
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-brand-ink/55">
                  {[a.subjectName, a.dueDate ? `due ${shortDate(a.dueDate)}` : null]
                    .filter(Boolean)
                    .join(" · ") || "No subject"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${assignmentStatusChip(a.status)}`}
                >
                  {ASSIGNMENT_STATUS_LABEL[a.status]}
                </span>
                {a.id !== upNextId ? (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => upNext(a.id)}
                    className="text-xs text-brand-plum-mid hover:underline disabled:opacity-50"
                  >
                    Up next
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => archive(a.id)}
                  className="text-xs text-brand-ink/45 hover:text-brand-plum disabled:opacity-50"
                >
                  Archive
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Assign next */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-brand-ink/60">
          From library
          <select
            value={worksheetId}
            onChange={(e) => setWorksheetId(e.target.value)}
            className="mt-1 block rounded-lg border border-brand-mist bg-white px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
          >
            <option value="">—</option>
            {worksheets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-brand-ink/60">
          or a quick task
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="p.42 Q1–10"
            className="mt-1 block rounded-lg border border-brand-mist px-3 py-1.5 text-sm text-brand-plum focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={add}
          disabled={isPending}
          className="rounded-lg bg-brand-plum px-4 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid disabled:opacity-50"
        >
          Assign
        </button>
      </div>

      {done.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-brand-plum-mid">
            {done.length} returned
          </summary>
          <ul className="mt-2 divide-y divide-brand-mist rounded-xl border border-brand-mist">
            {done.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <span className="text-brand-ink/70">{a.title}</span>
                <span className="text-xs text-brand-ink/45">Returned</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
