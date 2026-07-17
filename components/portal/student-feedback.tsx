import { shortDate } from "@/lib/billing";
import { VERDICT_CHIP } from "@/lib/homework";
import {
  ISSUE_TYPE_LABEL,
  VERDICT_LABEL,
  type CorrectionItem,
  type CorrectionMode,
} from "@/lib/homework-types";

/**
 * A RELEASED correction, as the student reads it (Slice D — doc 26 §2D).
 *
 * Read-only, and a server component: there is nothing here to interact with. The
 * student is the audience for the marks — "score stays tutor-side AND
 * student-side" — so unlike the parent view this shows the per-item verdicts and
 * the tally, not just the voiced note. The parent's version of this same row is
 * the voiced_note alone, via parent_corrections (policies.sql §11f).
 *
 * Nothing reaches this component until Fatima has released it: the DB won't
 * return an unreleased row on a student's JWT (corrections_select_staff_or_student).
 * So an AI draft she hasn't reviewed can never be read by a child — the same
 * review-before-release spine as the parent heartbeat, and the reason correction
 * feedback is trustworthy at all.
 *
 * Handles both C.5 output modes:
 *   marking  — per-question right/wrong/partial (maths/science);
 *   language — per-sentence issue + suggested rewrite, no verdict (English).
 */
export function StudentFeedback({
  mode,
  items,
  voicedNote,
  summary,
  releasedAt,
}: {
  mode: CorrectionMode;
  items: CorrectionItem[];
  voicedNote: string | null;
  summary: string | null;
  releasedAt: string | null;
}) {
  return (
    <article className="rounded-2xl border border-brand-mist bg-white p-5">
      {/* Her note comes FIRST, above the marks. Deliberate: it's written in her
          voice and it's the part that lands with a child. A grid of red
          verdicts at the top of the screen is a different message than the one
          she wrote. */}
      {voicedNote ? (
        <div className="rounded-xl border border-brand-mist bg-brand-cream/40 p-4">
          <p className="whitespace-pre-line text-sm leading-relaxed text-brand-ink/85">
            {voicedNote}
          </p>
        </div>
      ) : null}

      {summary ? (
        <p className="mt-3 text-xs font-medium text-brand-plum-mid">{summary}</p>
      ) : null}

      {items.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-3">
          {items.map((it, i) => (
            <li
              key={i}
              className="border-t border-brand-mist pt-3 first:border-t-0 first:pt-0"
            >
              {mode === "language" ? (
                <LanguageItem item={it} />
              ) : (
                <MarkingItem item={it} />
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {releasedAt ? (
        <p className="mt-4 border-t border-brand-mist pt-2 text-xs text-brand-ink/45">
          Marked {shortDate(releasedAt.slice(0, 10))}
        </p>
      ) : null}
    </article>
  );
}

function MarkingItem({ item }: { item: CorrectionItem }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 w-6 shrink-0 text-xs font-medium text-brand-ink/45">
        {item.label || item.number}
      </span>
      <div className="min-w-0 flex-1">
        {item.verdict ? (
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${VERDICT_CHIP[item.verdict]}`}
          >
            {VERDICT_LABEL[item.verdict]}
          </span>
        ) : null}
        {item.comment ? (
          <p className="mt-1 text-sm leading-relaxed text-brand-ink/75">
            {item.comment}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LanguageItem({ item }: { item: CorrectionItem }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-brand-ink/45">
          {item.label || item.number}
        </span>
        {item.issueType ? (
          <span className="rounded-full bg-brand-gold/15 px-2 py-0.5 text-xs font-medium text-brand-plum">
            {ISSUE_TYPE_LABEL[item.issueType]}
          </span>
        ) : null}
      </div>
      {item.original ? (
        <p className="mt-1.5 text-sm leading-relaxed text-brand-ink/55 line-through decoration-brand-ink/25">
          {item.original}
        </p>
      ) : null}
      {item.suggestion ? (
        <p className="mt-1 text-sm leading-relaxed font-medium text-brand-plum">
          {item.suggestion}
        </p>
      ) : null}
      {item.comment ? (
        <p className="mt-1 text-sm leading-relaxed text-brand-ink/70">
          {item.comment}
        </p>
      ) : null}
    </div>
  );
}
