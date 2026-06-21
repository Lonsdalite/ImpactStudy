"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setStudentActive, deleteStudent } from "@/lib/actions/students";

/**
 * Staff controls on a student record:
 *  - Archive / Reactivate (active flag) — keeps all history, removes from
 *    rosters/billing. The right move for crash-course / seasonal students.
 *  - Delete permanently — cascades attendance + payments. Mistakes only.
 *    Uses an in-app two-step confirm (no native browser dialog).
 */
export function StudentAdmin({
  studentId,
  studentName,
  active,
}: {
  studentId: string;
  studentName: string;
  active: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function archive() {
    startTransition(async () => {
      const res = await setStudentActive(studentId, !active);
      if (res.ok) {
        toast.success(
          active ? `${studentName} archived` : `${studentName} reactivated`,
        );
        router.refresh();
      } else {
        toast.error("Couldn't update");
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteStudent(studentId);
      if (res.ok) {
        toast.success(`${studentName} deleted`);
        router.push("/dashboard/students");
      } else {
        toast.error("Couldn't delete");
        setConfirming(false);
      }
    });
  }

  return (
    <div className="mt-8 border-t border-brand-mist pt-5">
      {confirming ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-5">
          <p className="text-sm font-medium text-red-800">
            Permanently delete {studentName}?
          </p>
          <p className="mt-1 max-w-xl text-sm text-red-700/80">
            This removes all their attendance and payment history and can&apos;t
            be undone. To keep their records instead, use Archive.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={remove}
              disabled={isPending}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-800 disabled:opacity-50"
            >
              Yes, delete permanently
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={isPending}
              className="text-sm text-brand-plum-mid hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={archive}
            disabled={isPending}
            className="rounded-lg border border-brand-mist px-4 py-2 text-sm font-medium text-brand-plum transition-colors hover:border-brand-plum/30 hover:bg-brand-plum/[0.04] disabled:opacity-50"
          >
            {active ? "Archive student" : "Reactivate student"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={isPending}
            className="text-xs text-brand-ink/40 underline-offset-2 hover:text-red-700 hover:underline disabled:opacity-50"
          >
            Delete permanently
          </button>
        </div>
      )}
    </div>
  );
}
