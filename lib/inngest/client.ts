import { Inngest } from "inngest";

/**
 * Inngest client.
 *
 * Reads INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY from process.env automatically.
 * For local dev with `npx inngest-cli dev`, env vars are ignored and a local
 * dev key is used.
 *
 * No job functions defined yet — added in Phase 1 as features come online
 * (e.g. weekly report generation, PDF ingestion, attendance reminders).
 */
export const inngest = new Inngest({
  id: "impactstudy",
});
