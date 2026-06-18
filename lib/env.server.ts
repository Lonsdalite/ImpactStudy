import "server-only";
import { z } from "zod";

/**
 * Server-only env vars — never imported by client components.
 * The "server-only" import will cause a build error if a client component
 * tries to use this module.
 */

const schema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  DATABASE_URL: z.string().url(),

  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),

  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().email(),

  // Optional — wired up later
  SENTRY_ORG: z.string().min(1).optional(),
  SENTRY_PROJECT: z.string().min(1).optional(),
  SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
  POSTHOG_PERSONAL_API_KEY: z.string().min(1).optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
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
