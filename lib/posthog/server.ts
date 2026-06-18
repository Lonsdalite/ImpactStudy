import "server-only";
import { PostHog } from "posthog-node";
import { env } from "@/lib/env";

/**
 * Server-side PostHog client.
 *
 * Use for capturing events from server actions, API routes, and Inngest jobs.
 * Tuned for serverless (Vercel functions) — flushes immediately so events
 * aren't lost when the function exits.
 *
 * Call `await client.shutdown()` at the end of long-running tasks; for
 * short request handlers, the immediate flush makes shutdown a no-op.
 */

let _client: PostHog | undefined;

export function posthogServer() {
  if (!_client) {
    _client = new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY, {
      host: env.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1, // flush on every capture
      flushInterval: 0, // no batching delay
    });
  }
  return _client;
}
