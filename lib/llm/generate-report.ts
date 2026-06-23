import "server-only";

import { renderVoice } from "@/lib/llm/voice";
import type { VoiceSignature } from "@/lib/voice-types";
import type { WeeklyStats } from "@/lib/reports";
import { shortDate } from "@/lib/billing";

/**
 * Parent heartbeat — the weekly progress note, written in the tutor's voice.
 *
 * Like CEQR (generate-practice.ts) this is voice-critical, so it calls Anthropic
 * DIRECTLY via fetch (no SDK, no provider abstraction — see doc 18 §2). Sonnet
 * 4.6 by default; it held Fatima's approved voice as well as Opus.
 *
 * ANTI-FABRICATION IS THE WHOLE GAME HERE. A parent note that invents a topic or
 * a score destroys trust instantly. So the model is handed ONLY the facts we
 * computed in lib/reports.ts and is told, repeatedly, to reference nothing else.
 */

export interface WeeklyReport {
  greeting: string;
  body: string;
  signoff: string;
  model: string; // the model the API actually used
}

const DEFAULT_MODEL = "claude-sonnet-4-6";

export async function generateWeeklyReport(input: {
  voice: VoiceSignature;
  studentName: string;
  yearLevel?: string;
  parentName?: string;
  stats: WeeklyStats;
}): Promise<WeeklyReport> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (and Vercel) to enable weekly reports.",
    );
  }
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const { stats } = input;

  // Build the ONLY facts the model is allowed to use. Plain English so the model
  // can't misread a schema; numbers are pre-computed so it can't miscount.
  const facts: string[] = [];
  facts.push(
    `Window: ${shortDate(stats.windowStart)} to ${shortDate(stats.windowEnd)} (this week).`,
  );
  facts.push(
    `Attended ${stats.attended} of ${stats.totalScheduled} scheduled sessions (present: ${stats.present}, late: ${stats.late}, absent: ${stats.absent}).`,
  );
  if (stats.streak >= 2) {
    facts.push(`Current attendance streak: ${stats.streak} sessions in a row.`);
  }
  if (stats.attendedSessions.length > 0) {
    facts.push(
      `Days attended: ${stats.attendedSessions.map((s) => shortDate(s.date)).join(", ")}.`,
    );
  }
  if (stats.notes.length > 0) {
    facts.push("Tutor notes from this week's lessons (use these for specifics):");
    for (const n of stats.notes) facts.push(`- ${shortDate(n.date)}: ${n.note}`);
  } else {
    facts.push(
      "No lesson notes were recorded this week — do NOT invent topics, scores, or specifics.",
    );
  }

  const system = [
    "You write a short weekly progress note from a tutor to a parent, in the tutor's EXACT voice.",
    "The voice IS the product. Match it precisely.",
    "",
    renderVoice(input.voice),
    "",
    "HARD RULES (anti-fabrication — non-negotiable):",
    "- Use ONLY the facts provided below. Never invent topics covered, marks, scores, behaviours, or events.",
    "- If there are no lesson notes, keep it about attendance, effort and encouragement — do not fabricate what was studied.",
    "- Do not mention money, fees, invoices or billing. This note is about progress only.",
    "- Be concise: 2–4 short sentences in the body. Warm, specific to the facts, never generic filler.",
    "- Address the parent about their child by first name. Refer to the child in the third person.",
    "- Output ONLY a JSON object, no markdown fences, exactly this shape:",
    '{"greeting": string, "body": string, "signoff": string}',
  ].join("\n");

  const user = [
    `Tutor: ${input.voice.tutorName}`,
    `Child: ${input.studentName}${input.yearLevel ? ` (${input.yearLevel})` : ""}`,
    input.parentName ? `Parent: ${input.parentName}` : "Parent: (address them warmly, no name)",
    "",
    "FACTS (the only things you may reference):",
    ...facts,
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
      max_tokens: 700,
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

  return { ...parseReport(text), model: data.model ?? model };
}

function parseReport(text: string): Omit<WeeklyReport, "model"> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const obj = JSON.parse(cleaned) as Partial<WeeklyReport>;
    if (typeof obj.body === "string") {
      return {
        greeting: typeof obj.greeting === "string" ? obj.greeting : "",
        body: obj.body.trim(),
        signoff: typeof obj.signoff === "string" ? obj.signoff : "",
      };
    }
  } catch {
    // fall through
  }
  // Fallback: surface the raw text as the body so nothing is lost.
  return { greeting: "", body: text.trim(), signoff: "" };
}
