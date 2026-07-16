"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { draftCorrection, discardSubmission } from "@/lib/actions/homework";
import { CORRECTION_PRESETS, presetByKey } from "@/lib/homework";

/** A submission that's been uploaded but not yet graded (no correction). */
export interface PendingSubmission {
  id: string;
  studentName: string;
  subjectName: string | null;
  /** Which quick-action preset to pre-select — defaulted by subject on the
   *  server (doc 36 item b) so Fatima usually just taps "Evaluate". */
  defaultPresetKey: string;
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
        Uploaded work waiting for AI marking. Pick what to do, then evaluate —
        nothing is graded until you do.
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
  const [presetKey, setPresetKey] = useState(submission.defaultPresetKey);
  const [instruction, setInstruction] = useState("");
  const [showInstruction, setShowInstruction] = useState(false);

  function evaluate() {
    const preset = presetByKey(presetKey);
    const combined = [preset.instruction, instruction.trim()]
      .filter(Boolean)
      .join(" ");
    startTransition(async () => {
      const res = await draftCorrection({
        submissionId: submission.id,
        mode: preset.mode,
        instruction: combined,
      });
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
          {submission.subjectName ? `${submission.subjectName} · ` : ""}
          {submission.pageCount} page{submission.pageCount > 1 ? "s" : ""}
        </span>
      </div>

      {submission.pageUrls.length > 0 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {submission.pageUrls.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={u}
              alt={`Page ${i + 1}`}
              loading="lazy"
              className="h-32 w-auto shrink-0 rounded-lg border border-brand-mist object-cover"
            />
          ))}
        </div>
      ) : null}

      {/* Quick-action presets — one tap sets mode + instruction. The default is
          pre-selected by subject, so she can usually skip straight to Evaluate. */}
      <div className="mt-4">
        <p className="text-xs font-medium text-brand-ink/60">What should I do?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {CORRECTION_PRESETS.map((p) => {
            const active = p.key === presetKey;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPresetKey(p.key)}
                disabled={isPending}
                aria-pressed={active}
                className={
                  "min-h-[40px] rounded-full border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 " +
                  (active
                    ? "border-brand-plum bg-brand-plum text-brand-cream"
                    : "border-brand-mist text-brand-ink/70 hover:bg-brand-plum/[0.05]")
                }
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {showInstruction ? (
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={isPending}
            placeholder="e.g. British English, Year 6, focus on tenses, be concise"
            className="mt-3 block w-full rounded-lg border border-brand-mist px-3 py-2 text-sm text-brand-ink/85 focus:border-brand-plum/30 focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowInstruction(true)}
            className="mt-2 text-xs text-brand-plum-mid hover:underline"
          >
            + Anything specific?
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={evaluate}
          disabled={isPending}
          className="inline-flex min-h-[44px] items-center rounded-lg bg-brand-plum px-4 py-2 text-xs font-medium text-brand-cream hover:bg-brand-plum-mid disabled:opacity-50"
        >
          {isPending ? "Evaluating…" : "Evaluate with AI"}
        </button>
        <button
          type="button"
          onClick={discard}
          disabled={isPending}
          className="inline-flex min-h-[44px] items-center rounded-lg border border-brand-mist px-4 py-2 text-xs font-medium text-brand-ink/60 hover:text-red-600 disabled:opacity-50"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
