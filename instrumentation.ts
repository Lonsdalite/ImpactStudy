import * as Sentry from "@sentry/nextjs";

/**
 * Next.js instrumentation hook — runs once at server start.
 * Branches by runtime so we don't double-init or load the wrong SDK.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Required by @sentry/nextjs to capture errors thrown from server components,
// route handlers, and server actions.
export const onRequestError = Sentry.captureRequestError;
