/**
 * Homework / AI-correction shared types (Slice C).
 *
 * Plain types only (no "server-only") so the Drizzle schema, server actions, and
 * client components can all import them — same split as lib/voice-types.ts.
 *
 * The jsonb payloads (submission pages, correction items + stats) live here so
 * the shape is defined once and reused by the LLM drafter, the server actions,
 * and the review UI.
 */

/** Who uploaded a submission. Polymorphic in the model; pilot = tutor-upload
 *  only. `student` / `parent` land with Slice D (student portal). */
export type UploaderRole = "tutor" | "student" | "parent";

/** One stored file that makes up a submission — an image page or a PDF. Path is
 *  the object key inside the private `submissions` bucket
 *  (`${tenantId}/${submissionId}/${filename}`). */
export interface SubmissionPage {
  path: string; // storage object key (no bucket prefix)
  name: string; // original file name, for display
  mime: string; // "image/jpeg" | "image/png" | "application/pdf"
}

/** Per-question verdict. `right | wrong | partial` is the locked output shape
 *  (doc 26 §2C). Red-pen-on-image annotations are deferred. */
export type Verdict = "right" | "wrong" | "partial";

export interface CorrectionItem {
  /** 1-based question number as it appears on the page. */
  number: number;
  verdict: Verdict;
  /** Short, specific note referencing the student's actual working. Editable by
   *  the tutor before release. */
  comment: string;
}

/** Snapshot of the tallies the report/diligence will read (doc 26 §2C —
 *  "stats snapshot for the report"). Computed from `items`, stored so a later
 *  edit to the item list is captured deterministically at release time. */
export interface CorrectionStats {
  total: number;
  right: number;
  wrong: number;
  partial: number;
}

/** Compute the tally snapshot from the graded items. */
export function tallyItems(items: CorrectionItem[]): CorrectionStats {
  const stats: CorrectionStats = { total: items.length, right: 0, wrong: 0, partial: 0 };
  for (const it of items) stats[it.verdict] += 1;
  return stats;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  right: "Right",
  wrong: "Wrong",
  partial: "Partial",
};

export const UPLOADER_LABEL: Record<UploaderRole, string> = {
  tutor: "Tutor",
  student: "Student",
  parent: "Parent",
};
