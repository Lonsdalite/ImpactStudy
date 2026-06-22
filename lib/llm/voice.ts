import "server-only";

import { FATIMA_VOICE, type VoiceSignature } from "@/lib/voice-types";

export { FATIMA_VOICE };
export type { VoiceSignature };

/** Render a voice signature into a prompt block. */
export function renderVoice(v: VoiceSignature): string {
  return [
    `Tutor: ${v.tutorName}`,
    `Voice register: ${v.register}`,
    `Openers they use: ${v.openers.join(", ")}`,
    `NEVER use: ${v.neverUse.join("; ")}`,
    "Voice patterns:",
    ...v.patterns.map((p) => `- ${p}`),
  ].join("\n");
}
