"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  discardSubmission,
  editCorrection,
  releaseCorrection,
} from "@/lib/actions/homework";
import {
  CORRECTION_STATUS_LABEL,
  VERDICT_CHIP,
  statsLine,
} from "@/lib/homework";
import {
  ISSUE_TYPES,
  ISSUE_TYPE_LABEL,
  VERDICT_LABEL,
  tallyItems,
  type CorrectionItem,
  type CorrectionMode,
  type CorrectionStats,
  type IssueType,
  type Verdict,
} from "@/lib/homework-types";
import { shortDate } from "@/lib/billing";
import type { CorrectionStatus } from "@/lib/db/schema";

/** One correction as the review list needs it. Page-signed image URLs are
 *  best-effort (a seeded placeholder with no real file comes back empty). */
export interface CorrectionView {
  id: string;
  submissionId: string;
  status: CorrectionStatus;
  mode: CorrectionMode;
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
  const isLanguage = correction.mode === "language";
  const [items, setItems] = useState<CorrectionItem[]>(correction.items);
  const [note, setNote] = useState(correction.voicedNote);
  const [isPending, startTransition] = useTransition();

  // Live stats for the header. Mode-aware; language preserves the model's
  // original `reviewed` count (editing flagged items doesn't change coverage).
  const liveStats = tallyItems(items, correction.mode, correction.stats?.reviewed);

  function updateItem(idx: number, patch: Partial<CorrectionItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function addItem() {
    setItems((prev) => [
      ...prev,
      isLanguage
        ? {
            number: prev.length + 1,
            label: String(prev.length + 1),
            issueType: "grammar" as IssueType,
            original: "",
            suggestion: "",
            comment: "",
          }
        : { number: prev.length + 1, verdict: "right" as Verdict, comment: "" },
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
    const lines = [note.trim(), ""];
    for (const it of items) {
      if (isLanguage) {
        const marker = it.label || `#${it.number}`;
        const type = it.issueType ? ISSUE_TYPE_LABEL[it.issueType] : "";
        lines.push(`${marker}${type ? ` (${type})` : ""}${it.comment ? ` — ${it.comment}` : ""}`);
        if (it.original || it.suggestion) {
          lines.push(`  “${it.original ?? ""}” → “${it.suggestion ?? ""}”`);
        }
      } else {
        lines.push(
          `Q${it.number}: ${it.verdict ? VERDICT_LABEL[it.verdict] : ""}${it.comment ? ` — ${it.comment}` : ""}`,
        );
      }
    }
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
        {statsLine(liveStats, correction.mode)}
        {isLanguage ? " · language" : ""}
        {correction.model ? ` · drafted by ${correction.model}` : ""}
      </p>

      {/* The student's work */}
      {correction.pageUrls.length > 0 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {correction.pageUrls.map((u, i) => (
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

      {/* Per-item review — verdict grid (marking) or issue + rewrite (language) */}
      <ul className="mt-4 flex flex-col gap-2">
        {items.map((it, idx) =>
          isLanguage ? (
            <LanguageItem
              key={idx}
              item={it}
              isDraft={isDraft}
              onChange={(patch) => updateItem(idx, patch)}
              onRemove={() => removeItem(idx)}
            />
          ) : (
            <MarkingItem
              key={idx}
              item={it}
              isDraft={isDraft}
              onChange={(patch) => updateItem(idx, patch)}
              onRemove={() => removeItem(idx)}
            />
          ),
        )}
        {items.length === 0 && !isDraft ? (
          <li className="rounded-xl border border-brand-mist bg-brand-cream/30 p-3 text-sm text-brand-ink/70">
            {isLanguage
              ? "Nothing to flag — the sentences all read well."
              : "No items."}
          </li>
        ) : null}
      </ul>
      {isDraft ? (
        <button
          type="button"
          onClick={addItem}
          className="mt-2 text-xs text-brand-plum-mid hover:underline"
        >
          {isLanguage ? "+ Add a sentence" : "+ Add a question"}
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
              className="inline-flex min-h-[44px] items-center rounded-lg border border-brand-mist px-4 py-2 text-xs font-medium text-brand-ink/70 hover:bg-brand-plum/[0.04] disabled:opacity-50"
            >
              Save draft
            </button>
            <button
              type="button"
              onClick={release}
              disabled={isPending}
              className="inline-flex min-h-[44px] items-center rounded-lg bg-brand-plum px-4 py-2 text-xs font-medium text-brand-cream hover:bg-brand-plum-mid disabled:opacity-50"
            >
              Review done — return
            </button>
            <button
              type="button"
              onClick={discard}
              disabled={isPending}
              className="ml-auto inline-flex min-h-[44px] items-center rounded-lg border border-brand-mist px-4 py-2 text-xs font-medium text-brand-ink/60 hover:text-red-600 disabled:opacity-50"
            >
              Discard
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={copyFeedback}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-brand-plum/30 px-4 py-2 text-xs font-medium text-brand-plum hover:bg-brand-plum/[0.06]"
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

/** MARKING item — the original verdict + comment row (unchanged behaviour). */
function MarkingItem({
  item,
  isDraft,
  onChange,
  onRemove,
}: {
  item: CorrectionItem;
  isDraft: boolean;
  onChange: (patch: Partial<CorrectionItem>) => void;
  onRemove: () => void;
}) {
  return (
    <li className="rounded-xl border border-brand-mist bg-brand-cream/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-brand-plum">Q{item.number}</span>
        {isDraft ? (
          <select
            value={item.verdict ?? "right"}
            onChange={(e) => onChange({ verdict: e.target.value as Verdict })}
            className="min-h-[36px] rounded-lg border border-brand-mist bg-white px-2 py-1 text-xs text-brand-plum focus:outline-none"
          >
            {VERDICTS.map((v) => (
              <option key={v} value={v}>
                {VERDICT_LABEL[v]}
              </option>
            ))}
          </select>
        ) : item.verdict ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${VERDICT_CHIP[item.verdict]}`}
          >
            {VERDICT_LABEL[item.verdict]}
          </span>
        ) : null}
        {isDraft ? (
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto text-xs text-brand-ink/45 hover:text-red-600"
          >
            Remove
          </button>
        ) : null}
      </div>
      {isDraft ? (
        <textarea
          value={item.comment}
          onChange={(e) => onChange({ comment: e.target.value })}
          rows={2}
          placeholder="What to say about this one…"
          className="mt-2 w-full resize-y rounded-lg border border-brand-mist px-3 py-2 text-sm text-brand-ink/85 focus:border-brand-plum/30 focus:outline-none"
        />
      ) : item.comment ? (
        <p className="mt-1 text-sm text-brand-ink/80">{item.comment}</p>
      ) : null}
    </li>
  );
}

/** LANGUAGE item — issue-type + original → suggested rewrite, no verdict. */
function LanguageItem({
  item,
  isDraft,
  onChange,
  onRemove,
}: {
  item: CorrectionItem;
  isDraft: boolean;
  onChange: (patch: Partial<CorrectionItem>) => void;
  onRemove: () => void;
}) {
  const marker = item.label || `#${item.number}`;
  return (
    <li className="rounded-xl border border-brand-mist bg-brand-cream/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-brand-plum">{marker}</span>
        {isDraft ? (
          <select
            value={item.issueType ?? "grammar"}
            onChange={(e) => onChange({ issueType: e.target.value as IssueType })}
            className="min-h-[36px] rounded-lg border border-brand-mist bg-white px-2 py-1 text-xs text-brand-plum focus:outline-none"
          >
            {ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {ISSUE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        ) : item.issueType ? (
          <span className="rounded-full bg-brand-plum/10 px-2 py-0.5 text-[11px] font-medium text-brand-plum">
            {ISSUE_TYPE_LABEL[item.issueType]}
          </span>
        ) : null}
        {isDraft ? (
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto text-xs text-brand-ink/45 hover:text-red-600"
          >
            Remove
          </button>
        ) : null}
      </div>

      {isDraft ? (
        <div className="mt-2 flex flex-col gap-2">
          <label className="text-[11px] text-brand-ink/50">
            Original
            <textarea
              value={item.original ?? ""}
              onChange={(e) => onChange({ original: e.target.value })}
              rows={2}
              placeholder="What the student wrote…"
              className="mt-0.5 w-full resize-y rounded-lg border border-brand-mist px-3 py-2 text-sm text-brand-ink/70 focus:border-brand-plum/30 focus:outline-none"
            />
          </label>
          <label className="text-[11px] text-brand-ink/50">
            Suggested rewrite
            <textarea
              value={item.suggestion ?? ""}
              onChange={(e) => onChange({ suggestion: e.target.value })}
              rows={2}
              placeholder="Your corrected version…"
              className="mt-0.5 w-full resize-y rounded-lg border border-brand-mist px-3 py-2 text-sm text-brand-ink/85 focus:border-brand-plum/30 focus:outline-none"
            />
          </label>
          <input
            type="text"
            value={item.comment}
            onChange={(e) => onChange({ comment: e.target.value })}
            placeholder="Why (optional) — e.g. comma splice, use a semicolon"
            className="w-full rounded-lg border border-brand-mist px-3 py-2 text-xs text-brand-ink/70 focus:border-brand-plum/30 focus:outline-none"
          />
        </div>
      ) : (
        <div className="mt-1.5 text-sm">
          {item.original ? (
            <p className="text-brand-ink/55 line-through decoration-brand-ink/25">
              {item.original}
            </p>
          ) : null}
          {item.suggestion ? (
            <p className="mt-0.5 text-brand-ink/85">
              <span className="text-brand-plum-mid">→ </span>
              {item.suggestion}
            </p>
          ) : null}
          {item.comment ? (
            <p className="mt-1 text-xs text-brand-ink/55">{item.comment}</p>
          ) : null}
        </div>
      )}
    </li>
  );
}
