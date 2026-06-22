import "server-only";

import { renderVoice } from "@/lib/llm/voice";
import type { VoiceSignature } from "@/lib/voice-types";

/**
 * CEQR — Concept Extraction + Question Regeneration.
 *
 * Generates a daily practice set in the tutor's voice. This is voice-critical
 * generation (the moat), so it calls Anthropic DIRECTLY (no provider
 * abstraction, by design — see 18_LLM_Stack_and_RAG_Architecture.md §2). Plain
 * fetch to the Messages API, no SDK dependency.
 *
 * "Regeneration" = questions are written fresh from the concept, never copied
 * from any source — which is what keeps third-party material safe (CEQR).
 */

export interface PracticeQuestion {
  prompt: string;
  hint: string;
}
export interface PracticeSet {
  greeting: string;
  questions: PracticeQuestion[];
  closing: string;
  model: string; // the model the API actually used (echoed in the response)
}

// Model for voice-critical work (evaluated at build time per the model-freshness
// instruction). Override with ANTHROPIC_MODEL. Sonnet 4.6 is the chosen default:
// strong voice match, fast, ~5x cheaper than Opus. Flip ANTHROPIC_MODEL to
// claude-opus-4-8 for the top tier (the model behind Fatima's approved sample)
// if the quality ever needs a notch more.
const DEFAULT_MODEL = "claude-sonnet-4-6";

export async function generatePracticeSet(input: {
  topic: string;
  voice: VoiceSignature;
  studentName?: string;
  yearLevel?: string;
  count?: number;
}): Promise<PracticeSet> {
  // Read directly from process.env so this feature isn't coupled to the strict
  // full-server-env validator (which checks unrelated Inngest/Resend vars).
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (and Vercel) to enable practice generation.",
    );
  }
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const count = Math.min(Math.max(input.count ?? 5, 3), 8);
  const name = input.studentName?.trim() || "there";

  const system = [
    "You write daily maths practice questions in a specific tutor's exact voice.",
    "The voice IS the product, so match it precisely.",
    "",
    renderVoice(input.voice),
    "",
    "Rules:",
    `- Write ${count} ORIGINAL questions on the given topic. Never copy from any source; regenerate from the concept.`,
    "- Pitch them at the student's year level, easiest first, with one stretch question last.",
    "- Each question gets a short, friendly hint in her voice.",
    "- Open with a warm greeting to the student and close with encouragement.",
    "- Output ONLY a JSON object, no markdown fences, exactly this shape:",
    '{"greeting": string, "questions": [{"prompt": string, "hint": string}], "closing": string}',
  ].join("\n");

  const user = [
    `Student: ${name}${input.yearLevel ? ` (${input.yearLevel})` : ""}`,
    `Topic: ${input.topic.trim()}`,
    `Generate ${count} questions.`,
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: user }],
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
  };
  const text = data.content?.find((c) => c.type === "text")?.text ?? "";

  return { ...parsePracticeSet(text), model: data.model ?? model };
}

function parsePracticeSet(text: string): Omit<PracticeSet, "model"> {
  // Strip any accidental ```json fences, then parse.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const obj = JSON.parse(cleaned) as Partial<PracticeSet>;
    if (Array.isArray(obj.questions)) {
      return {
        greeting: typeof obj.greeting === "string" ? obj.greeting : "",
        questions: obj.questions.map((q) => ({
          prompt: String(q?.prompt ?? "").trim(),
          hint: String(q?.hint ?? "").trim(),
        })),
        closing: typeof obj.closing === "string" ? obj.closing : "",
      };
    }
  } catch {
    // fall through
  }
  // Fallback: show the raw text as a single block so nothing is lost.
  return { greeting: "", questions: [{ prompt: text.trim(), hint: "" }], closing: "" };
}
