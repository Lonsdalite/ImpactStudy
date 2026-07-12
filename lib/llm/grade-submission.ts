import "server-only";

import { renderVoice } from "@/lib/llm/voice";
import type { VoiceSignature } from "@/lib/voice-types";
import {
  tallyItems,
  type CorrectionItem,
  type CorrectionStats,
  type Verdict,
} from "@/lib/homework-types";

/**
 * AI correction (Slice C) — the vision + math-grading + voiced-note drafter.
 *
 * ONE multimodal Anthropic call does both jobs on a photo of a student's work:
 *   1. Vision + maths grading → a per-question verdict (right/wrong/partial).
 *   2. A short feedback note in the TUTOR'S voice, referencing the work.
 * Keeping it to one call is the whole tokenomics story: the image is the cost
 * driver, so we send it once and get verdicts + note back together.
 *
 * MODEL (models-not-locked rule, doc 26 §2C / doc 18 §0): default
 * claude-sonnet-5 — strong maths-vision reasoning, fast, well within range for
 * Y5–Y10 worksheet marking, and far cheaper than the flagship. It has its OWN
 * knob (ANTHROPIC_GRADING_MODEL), independent of the voice-generation
 * ANTHROPIC_MODEL, so grading can be tuned (up to Opus, or down to Haiku)
 * without touching the heartbeat. Review-before-release is the backstop: the AI
 * only ever DRAFTS (doc 26 §2C).
 */

export interface GradedSubmission {
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

export async function gradeSubmission(input: {
  voice: VoiceSignature;
  pages: GradePage[];
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
  const model = process.env.ANTHROPIC_GRADING_MODEL || DEFAULT_GRADING_MODEL;

  const system = [
    "You are marking a photo (or PDF) of a student's handwritten work for their tutor.",
    "You do TWO things: (1) grade each question, (2) write a short feedback note in the tutor's EXACT voice.",
    "",
    "The note is voice-critical — the voice IS the product. Match it precisely:",
    renderVoice(input.voice),
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

  const context = [
    input.studentName
      ? `Student: ${input.studentName}${input.yearLevel ? ` (${input.yearLevel})` : ""}`
      : "Student: (unnamed)",
    input.subject ? `Subject: ${input.subject}` : null,
    input.assignmentTitle ? `Worksheet: ${input.assignmentTitle}` : null,
    "Grade every question on the page(s) above, then write the note.",
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
      // over 1500 (a full worksheet of verdicts + comments + the note).
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
    `[grade-submission] model=${data.model ?? model} stop_reason=${
      data.stop_reason ?? "?"
    } blocks=${(data.content ?? []).map((c) => c.type).join(",") || "none"} text_len=${text.length}`,
  );

  const parsed = parseGraded(text);
  // Fail loudly instead of persisting a silent empty draft (the tutor should
  // know a page didn't grade, not stare at a blank card).
  if (parsed.items.length === 0 && !parsed.voicedNote) {
    throw new Error(
      data.stop_reason === "max_tokens"
        ? "The grader ran out of room on this page. Try one page at a time, or a clearer/tighter photo."
        : "Couldn't read the answers on this page. Try a clearer, upright photo cropped to just the work.",
    );
  }
  return {
    items: parsed.items,
    voicedNote: parsed.voicedNote,
    stats: tallyItems(parsed.items),
    model: data.model ?? model,
  };
}

function parseGraded(text: string): {
  items: CorrectionItem[];
  voicedNote: string;
} {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  // Try the whole thing first; if the model wrapped the JSON in prose, fall back
  // to the widest {...} span so a stray sentence doesn't blank the whole grade.
  let candidate = cleaned;
  try {
    JSON.parse(candidate);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first !== -1 && last > first) candidate = cleaned.slice(first, last + 1);
  }
  try {
    const obj = JSON.parse(candidate) as {
      items?: unknown;
      voicedNote?: unknown;
    };
    const rawItems = Array.isArray(obj.items) ? obj.items : [];
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
    return {
      items,
      voicedNote:
        typeof obj.voicedNote === "string" ? obj.voicedNote.trim() : "",
    };
  } catch {
    // Fallback: no structured grade, but keep the model's prose as the note so
    // nothing is lost and the tutor can still work from it.
    return { items: [], voicedNote: text.trim() };
  }
}
