"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  discardSubmission,
  editCorrection,
  releaseCorrection,
} from "@/lib/actions/homework";
import { CORRECTION_STATUS_LABEL, VERDICT_CHIP, scoreLine } from "@/lib/homework";
import { VERDICT_LABEL, type CorrectionItem, type CorrectionStats, type Verdict } from "@/lib/homework-types";
import { shortDate } from "@/lib/billing";
import type { CorrectionStatus } from "@/lib/db/schema";

/** One correction as the review list needs it. Page-signed image URLs are
 *  best-effort (a seeded placeholder with no real file comes back empty). */
export interface CorrectionView {
  id: string;
  submissionId: string;
  status: CorrectionStatus;
  studentName: string;
  items: CorrectionItem[];
  voicedNote: string;
  stats: CorrectionStats | null;
  model: string | null;
  pageUrls: string[];
  releasedAt: string | null;
}

const VERDICTS: Verdict[] = ["right", "wrong", "partial"];

export function CorrectionReview({ corrections }: { corrections: CorrectionView[] }) {
  const router = useRouter();
  const drafts = corrections.filter((c) => c.status === "draft");
  const released = corrections.filter((c) => c.status === "released");

  return (
    <div className="flex flex-col gap-4">
      {corrections.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-brand-mist bg-white/50 px-5 py-8 text-center text-sm text-brand-ink/55">
          No corrections yet. Upload a photo of a student&apos;s work above and
          the AI will draft the marks — you review every one before it goes out.
        </p>
      ) : null}

      {drafts.map((c) => (
        <CorrectionCard key={c.id} correction={c} onChanged={() => router.refresh()} />
      ))}

      {released.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-brand-plum-mid">
            {released.length} returned
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {released.map((c) => (
              <CorrectionCard
                key={c.id}
                correction={c}
                onChanged={() => router.refresh()}
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function CorrectionCard({
  correction,
  onChanged,
}: {
  correction: CorrectionView;
  onChanged: () => void;
}) {
  const isDraft = correction.status === "draft";
  const [items, setItems] = useState<CorrectionItem[]>(correction.items);
  const [note, setNote] = useState(correction.voicedNote);
  const [isPending, startTransition] = useTransition();

  const stats: CorrectionStats = {
    total: items.length,
    right: items.filter((i) => i.verdict === "right").length,
    wrong: items.filter((i) => i.verdict === "wrong").length,
    partial: items.filter((i) => i.verdict === "partial").length,
  };

  function updateItem(idx: number, patch: Partial<CorrectionItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function addItem() {
    setItems((prev) => [
      ...prev,
      { number: prev.length + 1, verdict: "right", comment: "" },
    ]);
  }

  function save() {
    startTransition(async () => {
      const res = await editCorrection({
        correctionId: correction.id,
        items,
        voicedNote: note,
      });
      if (res.ok) {
        toast.success("Saved");
        onChanged();
      } else {
        toast.error(res.error ?? "Couldn't save");
      }
    });
  }

  function discard() {
    startTransition(async () => {
      const res = await discardSubmission(correction.submissionId);
      if (res.ok) {
        toast.success("Draft discarded");
        onChanged();
      } else {
        toast.error(res.error ?? "Couldn't discard");
      }
    });
  }

  function release() {
    startTransition(async () => {
      // Persist any in-flight edits first, then release.
      const edit = await editCorrection({
        correctionId: correction.id,
        items,
        voicedNote: note,
      });
      if (!edit.ok) {
        toast.error(edit.error ?? "Couldn't save before releasing");
        return;
      }
      const res = await releaseCorrection(correction.id);
      if (res.ok) {
        toast.success(`Returned to ${correction.studentName}`);
        onChanged();
      } else {
        toast.error(res.error ?? "Couldn't release");
      }
    });
  }

  async function copyFeedback() {
    const lines = [
      note.trim(),
      "",
      ...items.map(
        (it) => `Q${it.number}: ${VERDICT_LABEL[it.verdict]}${it.comment ? ` — ${it.comment}` : ""}`,
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Feedback copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  return (
    <div className="rounded-2xl border border-brand-mist bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-brand-plum">{correction.studentName}</span>
        <span
          className={
            "rounded-full px-3 py-1 text-xs font-medium " +
            (isDraft ? "bg-brand-gold/15 text-brand-plum" : "bg-brand-plum text-brand-cream")
          }
        >
          {CORRECTION_STATUS_LABEL[correction.status]}
        </span>
      </div>

      <p className="mt-1 text-xs text-brand-ink/55">
        {scoreLine(stats)}
        {correction.model ? ` · drafted by ${correction.model}` : ""}
      </p>

      {/* The student's work */}
      {correction.pageUrls.length > 0 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {correction.pageUrls.map((u, i) => (
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

      {/* Per-item verdicts */}
      <ul className="mt-4 flex flex-col gap-2">
        {items.map((it, idx) => (
          <li
            key={idx}
            className="rounded-xl border border-brand-mist bg-brand-cream/30 p-3"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-brand-plum">Q{it.number}</span>
              {isDraft ? (
                <select
                  value={it.verdict}
                  onChange={(e) => updateItem(idx, { verdict: e.target.value as Verdict })}
                  className="rounded-lg border border-brand-mist bg-white px-2 py-1 text-xs text-brand-plum focus:outline-none"
                >
                  {VERDICTS.map((v) => (
                    <option key={v} value={v}>
                      {VERDICT_LABEL[v]}
                    </option>
                  ))}
                </select>
              ) : (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${VERDICT_CHIP[it.verdict]}`}
                >
                  {VERDICT_LABEL[it.verdict]}
                </span>
              )}
              {isDraft ? (
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="ml-auto text-xs text-brand-ink/45 hover:text-red-600"
                >
                  Remove
                </button>
              ) : null}
            </div>
            {isDraft ? (
              <textarea
                value={it.comment}
                onChange={(e) => updateItem(idx, { comment: e.target.value })}
                rows={2}
                placeholder="What to say about this one…"
                className="mt-2 w-full resize-y rounded-lg border border-brand-mist px-3 py-2 text-sm text-brand-ink/85 focus:border-brand-plum/30 focus:outline-none"
              />
            ) : it.comment ? (
              <p className="mt-1 text-sm text-brand-ink/80">{it.comment}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {isDraft ? (
        <button
          type="button"
          onClick={addItem}
          className="mt-2 text-xs text-brand-plum-mid hover:underline"
        >
          + Add a question
        </button>
      ) : null}

      {/* Voiced note */}
      <div className="mt-4">
        <p className="text-xs font-medium text-brand-ink/60">
          Note to the student, in your voice
        </p>
        {isDraft ? (
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1 w-full resize-y rounded-lg border border-brand-mist px-3 py-2 text-sm leading-relaxed text-brand-ink/85 focus:border-brand-plum/30 focus:outline-none"
          />
        ) : (
          <p className="mt-1 whitespace-pre-line rounded-xl border border-brand-mist bg-brand-cream/40 p-4 text-sm leading-relaxed text-brand-ink/85">
            {note}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isDraft ? (
          <>
            <button
              type="button"
              onClick={save}
              disabled={isPending}
              className="rounded-lg border border-brand-mist px-4 py-1.5 text-xs font-medium text-brand-ink/70 hover:bg-brand-plum/[0.04] disabled:opacity-50"
            >
              Save draft
            </button>
            <button
              type="button"
              onClick={release}
              disabled={isPending}
              className="rounded-lg bg-brand-plum px-4 py-1.5 text-xs font-medium text-brand-cream hover:bg-brand-plum-mid disabled:opacity-50"
            >
              Review done — return
            </button>
            <button
              type="button"
              onClick={discard}
              disabled={isPending}
              className="ml-auto rounded-lg border border-brand-mist px-4 py-1.5 text-xs font-medium text-brand-ink/60 hover:text-red-600 disabled:opacity-50"
            >
              Discard
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={copyFeedback}
              className="rounded-lg border border-brand-plum/30 px-4 py-1.5 text-xs font-medium text-brand-plum hover:bg-brand-plum/[0.06]"
            >
              Copy feedback
            </button>
            {correction.releasedAt ? (
              <span className="ml-auto text-xs text-brand-ink/45">
                Returned {shortDate(correction.releasedAt.slice(0, 10))}
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
