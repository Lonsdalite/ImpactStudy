import type { AssignmentStatus, CorrectionStatus } from "@/lib/db/schema";
import type {
  CorrectionMode,
  CorrectionStats,
  Verdict,
} from "@/lib/homework-types";

/**
 * Homework display helpers (Slice C). Pure — no server-only — so the pipeline,
 * the morning board, and the correction workstation share one vocabulary for
 * statuses and verdicts.
 */

// Upload guardrails. Aligned to the Claude app so the tool never feels more
// restrictive than what tutors already use (claude.ai allows 20 images/message,
// 10 MB each). Real homework is 1–6 pages; client-side downscaling — not this
// cap — controls the token bill, so a generous cap is essentially free. Also
// enforced server-side (createSubmission) as defense in depth.
export const MAX_SUBMISSION_PAGES = 20;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB per file

// Private Storage bucket names. Defined here (a client-safe module) — NOT in
// lib/storage.ts, which is `server-only` — so client components (the uploader,
// the library) can build the `${tenantId}/…` upload paths without pulling the
// server Supabase client into the browser bundle. lib/storage.ts re-exports
// these for server code.
export const WORKSHEETS_BUCKET = "worksheets";
export const SUBMISSIONS_BUCKET = "submissions";

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
  assigned: "Assigned",
  submitted: "To correct",
  corrected: "Drafted",
  returned: "Returned",
  archived: "Archived",
};

// Pipeline order (assigned → submitted → corrected → returned). `archived` sits
// outside the flow.
export const ASSIGNMENT_FLOW: AssignmentStatus[] = [
  "assigned",
  "submitted",
  "corrected",
  "returned",
];

// The three morning-board columns (doc 26 §2C — who owes work / needs
// correction / returned), each mapping to one or more pipeline statuses.
export const BOARD_COLUMNS: {
  key: string;
  label: string;
  statuses: AssignmentStatus[];
}[] = [
  { key: "owes", label: "Owes work", statuses: ["assigned"] },
  { key: "correct", label: "Needs correction", statuses: ["submitted"] },
  { key: "review", label: "Draft to review", statuses: ["corrected"] },
  { key: "returned", label: "Returned", statuses: ["returned"] },
];

export function assignmentStatusChip(status: AssignmentStatus): string {
  switch (status) {
    case "assigned":
      return "bg-brand-gold/15 text-brand-plum";
    case "submitted":
      return "bg-brand-plum/10 text-brand-plum";
    case "corrected":
      return "bg-brand-sage/20 text-brand-plum";
    case "returned":
      return "bg-brand-plum text-brand-cream";
    case "archived":
      return "bg-brand-mist text-brand-ink/50";
  }
}

export const CORRECTION_STATUS_LABEL: Record<CorrectionStatus, string> = {
  draft: "Draft",
  released: "Returned",
};

export const VERDICT_CHIP: Record<Verdict, string> = {
  right: "bg-brand-sage/20 text-brand-plum",
  wrong: "bg-red-100 text-red-700",
  partial: "bg-brand-gold/20 text-brand-plum",
};

/** "3/5 right" style summary from a graded item list (MARKING mode). */
export function scoreLine(stats: {
  total: number;
  right: number;
  partial: number;
}): string {
  if (stats.total === 0) return "No items graded";
  const parts = [`${stats.right}/${stats.total} right`];
  if (stats.partial > 0) parts.push(`${stats.partial} partial`);
  return parts.join(" · ");
}

/** "53 reviewed · 8 suggestions" style summary (LANGUAGE mode). The diligence
 *  signal is coverage + suggestions, never a score (doc 36 item b). */
export function languageStatsLine(stats: CorrectionStats): string {
  const reviewed = stats.reviewed ?? stats.total;
  const suggestions = stats.suggestions ?? stats.total;
  if (reviewed === 0) return "No sentences reviewed";
  return `${reviewed} sentence${reviewed === 1 ? "" : "s"} reviewed · ${suggestions} suggestion${suggestions === 1 ? "" : "s"}`;
}

/** Mode-aware one-liner for the review card + report. */
export function statsLine(stats: CorrectionStats, mode: CorrectionMode): string {
  return mode === "language" ? languageStatsLine(stats) : scoreLine(stats);
}

/**
 * Quick-action correction presets (Slice C.5 item b). One tap sets BOTH the
 * output mode AND a starter instruction; the set is deliberately small. The
 * evaluate step defaults the preset BY SUBJECT (see defaultPresetKey) so Fatima
 * usually taps nothing — just "Evaluate". The optional free-text "Anything
 * specific?" is appended to the chosen preset's instruction.
 */
export interface CorrectionPreset {
  key: string;
  label: string;
  mode: CorrectionMode;
  instruction: string;
}

export const CORRECTION_PRESETS: CorrectionPreset[] = [
  { key: "mark", label: "Mark answers", mode: "marking", instruction: "" },
  {
    key: "language",
    label: "Correct language",
    mode: "language",
    instruction: "Correct grammar, punctuation and vocabulary.",
  },
  {
    key: "phrasing",
    label: "Suggest better phrasing",
    mode: "language",
    instruction:
      "Suggest smoother, more natural phrasing. Only flag sentences that could read better.",
  },
  {
    key: "answerkey",
    label: "Mark against answer key",
    mode: "marking",
    instruction: "Mark against the answer key shown on the page.",
  },
];

export function presetByKey(key: string): CorrectionPreset {
  return CORRECTION_PRESETS.find((p) => p.key === key) ?? CORRECTION_PRESETS[0];
}

/** Default preset for a subject so she usually taps nothing: English → correct
 *  language; everything else (maths/science/unknown) → mark answers. Keeping
 *  the maths default on `mark` is what makes the maths path a no-op regression. */
export function defaultPresetKey(subjectName?: string | null): string {
  const s = (subjectName ?? "").toLowerCase();
  if (s.includes("english")) return "language";
  return "mark";
}
