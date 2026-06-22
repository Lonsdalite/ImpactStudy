import "server-only";

import type { VoiceSignature } from "@/lib/voice-types";

/**
 * Derive a VoiceSignature from a tutor's real messages — the same analysis we
 * did by hand for Fatima's WhatsApp exchange, now automated. Voice-critical, so
 * direct Anthropic fetch (no abstraction). The tutor reviews/edits the result
 * before it's saved.
 */
const DEFAULT_MODEL = "claude-sonnet-4-6";

export async function extractVoiceSignature(
  samples: string,
): Promise<VoiceSignature> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (and Vercel) to enable voice capture.",
    );
  }
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const system = [
    "You analyse a tutor's real messages and extract their VOICE SIGNATURE — a precise profile of HOW they write, so an AI can imitate them convincingly.",
    "Capture what's distinctive: greetings, tone and dialect/register, how they encourage, the kinds of real-world examples they reach for, punctuation habits, and anything they'd never say.",
    "Output ONLY a JSON object, no markdown fences, exactly this shape:",
    '{"tutorName": string, "register": string, "openers": string[], "neverUse": string[], "patterns": string[]}',
    '- tutorName: their first name if evident, else "".',
    "- register: one line describing their tone + dialect/register.",
    "- openers: how they greet, using {name} as a placeholder for the recipient.",
    "- neverUse: words, phrasings, or styles they would clearly never use.",
    "- patterns: 4 to 7 specific, actionable style rules an AI can follow to write like them.",
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
      max_tokens: 1200,
      system,
      messages: [
        { role: "user", content: `The tutor's messages:\n\n${samples.trim()}` },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API error (${res.status}). ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = data.content?.find((c) => c.type === "text")?.text ?? "";
  return parseVoice(text);
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
}

function parseVoice(text: string): VoiceSignature {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const obj = JSON.parse(cleaned) as Partial<Record<keyof VoiceSignature, unknown>>;
  return {
    tutorName: typeof obj.tutorName === "string" ? obj.tutorName : "",
    register: typeof obj.register === "string" ? obj.register : "",
    openers: asStringArray(obj.openers),
    neverUse: asStringArray(obj.neverUse),
    patterns: asStringArray(obj.patterns),
  };
}
