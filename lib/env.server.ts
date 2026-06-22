import "server-only";
import { z } from "zod";

/**
 * Server-only env vars — never imported by client components.
 * The "server-only" import will cause a build error if a client component
 * tries to use this module.
 */

// Treat an empty-string env var as "not set". .env files and Vercel often leave
// a key present but blank (e.g. `SENTRY_AUTH_TOKEN=`); without this, an optional
// z.string().min(1) rejects "" and the whole validation throws.
const optional = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().min(1).optional(),
);

const schema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  DATABASE_URL: z.string().url(),

  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),

  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().email(),

  // Anthropic (voice-critical generation — CEQR practice, parent reports).
  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_MODEL: optional,

  // Optional — wired up later
  SENTRY_ORG: optional,
  SENTRY_PROJECT: optional,
  SENTRY_AUTH_TOKEN: optional,
  POSTHOG_PERSONAL_API_KEY: optional,
  CLOUDFLARE_ACCOUNT_ID: optional,
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Invalid server env vars:",
    parsed.error.flatten().fieldErrors,
  );
  throw new Error("Invalid server environment variables");
}

export const serverEnv = parsed.data;
