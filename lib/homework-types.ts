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

/** Per-question verdict. `right | wrong | partial` is the locked MARKING output
 *  shape (doc 26 §2C). Red-pen-on-image annotations are deferred. */
export type Verdict = "right" | "wrong" | "partial";

/** Correction output model (Slice C.5, Muqsith-blessed subject-aware evolution
 *  of the locked spec — doc 36 item b). The category set stays locked; the
 *  IMPLEMENTATION tracks what's actually useful per subject:
 *
 *  - `marking`  — maths/science: a per-question verdict grid (right/wrong/
 *                 partial). Byte-for-byte the original Slice C behaviour.
 *  - `language` — English: per-sentence issue-type + suggested rewrite, NO
 *                 right/wrong verdict. Reads like Fatima's real Claude flow
 *                 ("flag each one that needs a fix; the rest were fine"). */
export type CorrectionMode = "marking" | "language";

/** The kind of language slip, for the `language` mode. Locked, small set —
 *  covers what Fatima's Claude sessions actually flag (typo, comma splice →
 *  punctuation, awkward phrasing, logic error, redundancy → style). */
export type IssueType =
  | "typo"
  | "grammar"
  | "punctuation"
  | "vocab"
  | "phrasing"
  | "logic"
  | "style";

export interface CorrectionItem {
  /** 1-based item number (marking: question; language: the model's running
   *  count of flagged sentences). `label` carries the real on-page marker. */
  number: number;
  /** Short, specific note. Marking: references the student's actual working.
   *  Language: why the sentence was flagged. Editable before release. */
  comment: string;
  /** MARKING mode only. Optional so a `language` item can omit it entirely
   *  (no verdict is shown for language). */
  verdict?: Verdict;
  // ---- language-mode fields (all optional; absent in marking mode, so a
  //      marking item serialises byte-for-byte as before) ----
  /** The kind of slip (language mode). */
  issueType?: IssueType;
  /** The on-page marker or vocabulary word this item refers to ("2", "M.",
   *  "Encroach") — Fatima's worksheets number inconsistently. */
  label?: string;
  /** The student's sentence as written (language mode) — the "original" half of
   *  the original → suggested view. */
  original?: string;
  /** The suggested rewrite (language mode) — the "suggested" half. */
  suggestion?: string;
}

/** Snapshot of the tallies the report/diligence will read (doc 26 §2C —
 *  "stats snapshot for the report"). Computed from `items` + mode, stored so a
 *  later edit to the item list is captured deterministically at release time.
 *
 *  Marking uses `{total,right,wrong,partial}` (unchanged). Language adds
 *  `reviewed` (how many sentences the model examined — more than `total`, which
 *  counts only the FLAGGED ones) and `suggestions` (how many carry a rewrite).
 *  The extra keys are simply absent in marking mode. */
export interface CorrectionStats {
  total: number;
  right: number;
  wrong: number;
  partial: number;
  /** Language mode: total sentences reviewed (flagged + fine). */
  reviewed?: number;
  /** Language mode: flagged items that carry a suggested rewrite. */
  suggestions?: number;
}

/** Compute the tally snapshot from the graded items + mode.
 *
 *  MARKING is byte-for-byte the original: `{total,right,wrong,partial}`, no
 *  extra keys. LANGUAGE returns `{total,right:0,wrong:0,partial:0,reviewed,
 *  suggestions}` — the diligence signal is "N sentences reviewed / M
 *  suggestions", never a score. */
export function tallyItems(
  items: CorrectionItem[],
  mode: CorrectionMode = "marking",
  reviewedCount?: number,
): CorrectionStats {
  if (mode === "language") {
    return {
      total: items.length,
      right: 0,
      wrong: 0,
      partial: 0,
      reviewed:
        typeof reviewedCount === "number" && reviewedCount >= items.length
          ? reviewedCount
          : items.length,
      suggestions: items.filter((it) => !!it.suggestion?.trim()).length,
    };
  }
  const stats: CorrectionStats = { total: items.length, right: 0, wrong: 0, partial: 0 };
  for (const it of items) if (it.verdict) stats[it.verdict] += 1;
  return stats;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  right: "Right",
  wrong: "Wrong",
  partial: "Partial",
};

export const CORRECTION_MODE_LABEL: Record<CorrectionMode, string> = {
  marking: "Marking",
  language: "Language",
};

export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  typo: "Typo",
  grammar: "Grammar",
  punctuation: "Punctuation",
  vocab: "Vocabulary",
  phrasing: "Phrasing",
  logic: "Logic",
  style: "Style",
};

export const ISSUE_TYPES: IssueType[] = [
  "typo",
  "grammar",
  "punctuation",
  "vocab",
  "phrasing",
  "logic",
  "style",
];

export const UPLOADER_LABEL: Record<UploaderRole, string> = {
  tutor: "Tutor",
  student: "Student",
  parent: "Parent",
};
