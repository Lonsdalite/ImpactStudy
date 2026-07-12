"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { draftCorrection, discardSubmission } from "@/lib/actions/homework";

/** A submission that's been uploaded but not yet graded (no correction). */
export interface PendingSubmission {
  id: string;
  studentName: string;
  pageUrls: string[];
  pageCount: number;
}

export function PendingSubmissions({
  submissions,
}: {
  submissions: PendingSubmission[];
}) {
  if (submissions.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium text-brand-plum">Ready to evaluate</h2>
      <p className="mt-1 text-xs text-brand-ink/55">
        Uploaded work waiting for AI marking. Nothing is graded until you
        evaluate it.
      </p>
      <div className="mt-4 flex flex-col gap-4">
        {submissions.map((s) => (
          <PendingCard key={s.id} submission={s} />
        ))}
      </div>
    </section>
  );
}

function PendingCard({ submission }: { submission: PendingSubmission }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function evaluate() {
    startTransition(async () => {
      const res = await draftCorrection({ submissionId: submission.id });
      if (res.ok) {
        toast.success("Marked — review the draft below");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't evaluate this page");
      }
    });
  }

  function discard() {
    startTransition(async () => {
      const res = await discardSubmission(submission.id);
      if (res.ok) {
        toast.success("Discarded");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't discard");
      }
    });
  }

  return (
    <div className="rounded-2xl border border-brand-mist bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-brand-plum">
          {submission.studentName}
        </span>
        <span className="text-xs text-brand-ink/55">
          {submission.pageCount} page{submission.pageCount > 1 ? "s" : ""}
        </span>
      </div>

      {submission.pageUrls.length > 0 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {submission.pageUrls.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={u}
              alt={`Page ${i + 1}`}
              className="h-32 w-auto rounded-lg border border-brand-mist object-cover"
            />
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={evaluate}
          disabled={isPending}
          className="rounded-lg bg-brand-plum px-4 py-1.5 text-xs font-medium text-brand-cream hover:bg-brand-plum-mid disabled:opacity-50"
        >
          {isPending ? "Evaluating…" : "Evaluate with AI"}
        </button>
        <button
          type="button"
          onClick={discard}
          disabled={isPending}
          className="rounded-lg border border-brand-mist px-4 py-1.5 text-xs font-medium text-brand-ink/60 hover:text-red-600 disabled:opacity-50"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
