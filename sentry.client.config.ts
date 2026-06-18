import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,

  // Performance monitoring — 10% sampling in dev, full in production.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 1.0 : 0.1,

  // Session replay — captures DOM mutations + clicks when an error fires.
  // Disabled in dev to avoid noise; enabled on prod errors only.
  replaysOnErrorSampleRate: process.env.NODE_ENV === "production" ? 1.0 : 0,
  replaysSessionSampleRate: 0, // never auto-replay healthy sessions (privacy + cost)

  integrations: [
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],

  // Suppress noise from browser extensions, ad-blockers, etc.
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "Non-Error promise rejection captured",
  ],
});
