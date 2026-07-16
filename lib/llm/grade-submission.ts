import "server-only";

import { renderVoice } from "@/lib/llm/voice";
import type { VoiceSignature } from "@/lib/voice-types";
import {
  tallyItems,
  ISSUE_TYPES,
  type CorrectionItem,
  type CorrectionMode,
  type CorrectionStats,
  type IssueType,
  type Verdict,
} from "@/lib/homework-types";

/**
 * AI correction (Slice C → C.5) — the vision + grading + voiced-note drafter.
 *
 * ONE multimodal Anthropic call does both jobs on a photo of a student's work:
 *   1. Vision reasoning → the per-item output (MODE-DEPENDENT, see below).
 *   2. A short feedback note in the TUTOR'S voice, referencing the work.
 * Keeping it to one call is the whole tokenomics story: the image is the cost
 * driver, so we send it once and get items + note back together.
 *
 * OUTPUT MODE (Slice C.5, doc 36 item b — Muqsith-blessed subject-aware model):
 *   - `marking`  — maths/science. Per-question verdict grid (right/wrong/
 *                  partial). This branch's prompt, request, and parse are
 *                  BYTE-FOR-BYTE the original Slice C behaviour: the maths path
 *                  must not regress.
 *   - `language` — English. Per-sentence issue-type + suggested rewrite, NO
 *                  verdict. Reads like Fatima's real Claude flow ("I'll flag
 *                  each one that needs a fix; the rest were fine as written").
 * An optional free-text `instruction` ("British English", "Year 6", "be
 * concise") is appended to the user turn in both modes.
 *
 * MODEL (models-not-locked rule, doc 26 §2C / doc 18 §0): default
 * claude-sonnet-5, with its OWN knob (ANTHROPIC_GRADING_MODEL) independent of
 * the voice-generation ANTHROPIC_MODEL. Review-before-release is the backstop:
 * the AI only ever DRAFTS (doc 26 §2C).
 *
 * PRIVACY (doc 35e §1, deferred ZDR item): the caller passes the student's
 * FIRST NAME only — never a full legal name — into the prompt text.
 */

export interface GradedSubmission {
  mode: CorrectionMode;
  items: CorrectionItem[];
  voicedNote: string;
  stats: CorrectionStats;
  model: string; // the model the API actually used
}

export interface GradePage {
  base64: string;
  mime: string; // "image/jpeg" | "image/png" | "image/webp" | "application/pdf"
}

const DEFAULT_GRADING_MODEL = "claude-sonnet-5";

const VERDICTS: Verdict[] = ["right", "wrong", "partial"];

/** The marking-mode system prompt. UNCHANGED from Slice C — keep it byte-for-byte
 *  so the maths/science path grades identically (regression-critical). */
function markingSystem(voice: VoiceSignature): string {
  return [
    "You are marking a photo (or PDF) of a student's handwritten work for their tutor.",
    "You do TWO things: (1) grade each question, (2) write a short feedback note in the tutor's EXACT voice.",
    "",
    "The note is voice-critical — the voice IS the product. Match it precisely:",
    renderVoice(voice),
    "",
    "GRADING RULES:",
    "- Go question by question in the order they appear. Number them 1, 2, 3… as printed if numbers are visible; otherwise number top-to-bottom.",
    "- verdict is exactly one of: 'right' (fully correct), 'wrong' (incorrect answer or method), 'partial' (right idea, slip in working, or incomplete).",
    "- The comment references the STUDENT'S ACTUAL WORKING — the specific step or number where it went right or wrong. Never generic.",
    "- If a question is illegible or you cannot read the answer, mark it 'partial' and say plainly you couldn't read it clearly. NEVER guess a mark.",
    "- Grade ONLY what is on the page. Do not invent extra questions, marks, or topics that aren't shown.",
    "",
    "VOICED NOTE RULES:",
    "- 2–4 short sentences, warm and specific to what you actually saw. Encourage by tying it to effort.",
    "- Reference the work concretely (e.g. 'your working on the ratio questions'), not vague praise.",
    "- No money/fees. No em dashes if the voice forbids them.",
    "",
    "Output ONLY a JSON object, no markdown fences, exactly this shape:",
    '{"items": [{"number": number, "verdict": "right"|"wrong"|"partial", "comment": string}], "voicedNote": string}',
  ].join("\n");
}

/** The language-mode system prompt (Slice C.5). Mirrors Fatima's Claude session:
 *  flag only the sentences that need a fix, with issue-type + rewrite, and say
 *  the rest were fine. No right/wrong verdict. British English by default. */
function languageSystem(voice: VoiceSignature): string {
  return [
    "You are reviewing a photo (or PDF) of a student's handwritten English work for their tutor.",
    "The student has written example sentences (often one per vocabulary word). Your job is to CORRECT THE LANGUAGE — grammar, punctuation, phrasing, and vocabulary — NOT to mark right/wrong.",
    "",
    "You do TWO things: (1) flag each sentence that needs a fix, (2) write a short feedback note in the tutor's EXACT voice.",
    "",
    "The note is voice-critical — the voice IS the product. Match it precisely:",
    renderVoice(voice),
    "",
    "CORRECTION RULES:",
    "- Go sentence by sentence in the order they appear.",
    "- ONLY include a sentence if it genuinely needs a fix. Do NOT list sentences that are already correct — leave them out entirely. Most sentences are usually fine.",
    "- For each FLAGGED sentence, give:",
    "  - label: the on-page marker for it — a number ('2'), a letter ('M.'), or the vocabulary word ('Encroach'). Use exactly what's on the page.",
    "  - number: a running 1, 2, 3… over the flagged items only.",
    "  - issueType: exactly one of typo | grammar | punctuation | vocab | phrasing | logic | style.",
    "  - original: the student's sentence (or the exact part that's wrong) as written.",
    "  - suggestion: your corrected rewrite of that sentence or part.",
    "  - comment: one short line on what to fix and why (e.g. \"comma splice — use a semicolon, not a comma\", \"'hunan' should be 'human'\").",
    "- reviewedCount: the TOTAL number of sentences you reviewed (flagged + fine) — so the tutor sees 'N reviewed, M flagged'.",
    "- Read ONLY what is on the page. Never invent sentences the student didn't write. If a sentence is illegible, say so in the comment rather than guessing a rewrite.",
    "- Use British English spelling and usage by default (unless the tutor's instruction says otherwise).",
    "",
    "VOICED NOTE RULES:",
    "- 2–4 short sentences, warm and specific. Mention roughly how many sentences you reviewed and that the rest read well as written. Encourage by tying it to effort.",
    "- No money/fees. No em dashes if the voice forbids them.",
    "",
    "Output ONLY a JSON object, no markdown fences, exactly this shape:",
    '{"reviewedCount": number, "items": [{"number": number, "label": string, "issueType": "typo"|"grammar"|"punctuation"|"vocab"|"phrasing"|"logic"|"style", "original": string, "suggestion": string, "comment": string}], "voicedNote": string}',
  ].join("\n");
}

export async function gradeSubmission(input: {
  voice: VoiceSignature;
  pages: GradePage[];
  mode?: CorrectionMode;
  instruction?: string;
  studentName?: string;
  yearLevel?: string;
  subject?: string;
  assignmentTitle?: string;
}): Promise<GradedSubmission> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (and Vercel) to enable AI correction.",
    );
  }
  if (input.pages.length === 0) {
    throw new Error("No pages to grade — upload at least one photo or PDF.");
  }
  const mode: CorrectionMode = input.mode === "language" ? "language" : "marking";
  const instruction = (input.instruction ?? "").trim().slice(0, 500);
  const model = process.env.ANTHROPIC_GRADING_MODEL || DEFAULT_GRADING_MODEL;

  const system =
    mode === "language" ? languageSystem(input.voice) : markingSystem(input.voice);

  // Build the multimodal user turn: the page images/PDFs, then the context line.
  type ContentBlock =
    | {
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      }
    | {
        type: "document";
        source: { type: "base64"; media_type: string; data: string };
      }
    | { type: "text"; text: string };

  const content: ContentBlock[] = input.pages.map((p) =>
    p.mime === "application/pdf"
      ? {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf",
            data: p.base64,
          },
        }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: p.mime,
            data: p.base64,
          },
        },
  );

  const closing =
    mode === "language"
      ? "Review every sentence on the page(s) above, flag the ones that need a fix, then write the note."
      : "Grade every question on the page(s) above, then write the note.";
  const context = [
    input.studentName
      ? `Student: ${input.studentName}${input.yearLevel ? ` (${input.yearLevel})` : ""}`
      : "Student: (unnamed)",
    input.subject ? `Subject: ${input.subject}` : null,
    input.assignmentTitle ? `Worksheet: ${input.assignmentTitle}` : null,
    instruction ? `Tutor's instruction: ${instruction}` : null,
    closing,
  ]
    .filter(Boolean)
    .join("\n");
  content.push({ type: "text", text: context });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      // A ceiling, not a target — billed on ACTUAL output, so a generous flat
      // cap costs nothing and just prevents truncation. Dense pages need well
      // over 1500 (a full worksheet of verdicts/rewrites + comments + the note).
      // NOTE: `pages` counts FILES, not physical pages — a single PDF can hold
      // many pages (Fatima's sample scan was 10), so we can't scale by file
      // count. 8000 covers a typical multi-page submission; a huge scan that
      // still hits max_tokens surfaces the "one page at a time" guidance below.
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Anthropic API error (${res.status}). ${detail.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
    model?: string;
    stop_reason?: string;
  };
  // Concatenate EVERY text block (a model may emit more than one, or a
  // non-text block before the text) rather than just the first.
  const text = (data.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n")
    .trim();

  // Diagnostics in the server log — the tell when a page grades empty.
  console.log(
    `[grade-submission] mode=${mode} model=${data.model ?? model} stop_reason=${
      data.stop_reason ?? "?"
    } blocks=${(data.content ?? []).map((c) => c.type).join(",") || "none"} text_len=${text.length}`,
  );

  const parsed = parseGraded(text, mode);
  // Fail loudly instead of persisting a silent empty draft (the tutor should
  // know a page didn't grade, not stare at a blank card). A LANGUAGE run with
  // no flagged items but a note ("all N were fine") is a VALID result, so the
  // guard only fires when BOTH items and note are empty.
  if (parsed.items.length === 0 && !parsed.voicedNote) {
    throw new Error(
      data.stop_reason === "max_tokens"
        ? "The grader ran out of room on this page. Try one page at a time, or a clearer/tighter photo."
        : "Couldn't read the answers on this page. Try a clearer, upright photo cropped to just the work.",
    );
  }
  return {
    mode,
    items: parsed.items,
    voicedNote: parsed.voicedNote,
    stats: tallyItems(parsed.items, mode, parsed.reviewedCount),
    model: data.model ?? model,
  };
}

/** Widen a raw model string to a JSON object candidate: strip fences, and if the
 *  whole thing isn't valid JSON, fall back to the widest {...} span so a stray
 *  sentence doesn't blank the whole result. */
function toJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let candidate = cleaned;
  try {
    JSON.parse(candidate);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first !== -1 && last > first) candidate = cleaned.slice(first, last + 1);
  }
  try {
    const obj = JSON.parse(candidate);
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseGraded(
  text: string,
  mode: CorrectionMode,
): { items: CorrectionItem[]; voicedNote: string; reviewedCount?: number } {
  const obj = toJsonObject(text);
  if (!obj) {
    // Fallback: no structured grade, but keep the model's prose as the note so
    // nothing is lost and the tutor can still work from it.
    return { items: [], voicedNote: text.trim() };
  }
  const rawItems = Array.isArray(obj.items) ? (obj.items as unknown[]) : [];
  const voicedNote =
    typeof obj.voicedNote === "string" ? obj.voicedNote.trim() : "";

  if (mode === "language") {
    const items: CorrectionItem[] = rawItems.map((raw, i) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const issueType: IssueType = ISSUE_TYPES.includes(r.issueType as IssueType)
        ? (r.issueType as IssueType)
        : "grammar";
      const number =
        typeof r.number === "number" && Number.isFinite(r.number)
          ? r.number
          : i + 1;
      // Marker: prefer the model's label; fall back to the running number.
      const label = String(r.label ?? "").trim() || String(number);
      const item: CorrectionItem = {
        number,
        label,
        issueType,
        original: String(r.original ?? "").trim(),
        suggestion: String(r.suggestion ?? "").trim(),
        comment: String(r.comment ?? "").trim(),
      };
      return item;
    });
    const reviewedCount =
      typeof obj.reviewedCount === "number" && Number.isFinite(obj.reviewedCount)
        ? obj.reviewedCount
        : undefined;
    return { items, voicedNote, reviewedCount };
  }

  // marking — byte-for-byte the original shape: {number, verdict, comment}.
  const items: CorrectionItem[] = rawItems.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const verdict = VERDICTS.includes(r.verdict as Verdict)
      ? (r.verdict as Verdict)
      : "partial";
    const number =
      typeof r.number === "number" && Number.isFinite(r.number)
        ? r.number
        : i + 1;
    return {
      number,
      verdict,
      comment: String(r.comment ?? "").trim(),
    };
  });
  return { items, voicedNote };
}
