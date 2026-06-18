import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Image optimization for the brand seal (and future logos/uploads).
  images: {
    remotePatterns: [],
  },
};

/**
 * Wrap with Sentry to enable source maps + error tracking in prod builds.
 * Source maps only upload if SENTRY_AUTH_TOKEN is set (left blank locally;
 * Vercel sets it in production builds).
 */
export default withSentryConfig(nextConfig, {
  org: "lonsdaleite",
  project: "javascript-nextjs",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // Optional: tunnels Sentry requests through our own domain to bypass
  // ad-blockers. Adds a /monitoring route. Off for Day 2 — re-enable later.
  // tunnelRoute: "/monitoring",
});
