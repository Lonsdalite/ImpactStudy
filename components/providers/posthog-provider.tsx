"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as Provider } from "posthog-js/react";

/**
 * PostHog browser client. Initialized once at module level so subsequent
 * renders don't re-init. Identification happens server-side (in middleware
 * or auth callback) via posthogServer().identify() once we wire user IDs.
 */
if (typeof window !== "undefined") {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: false, // we do it manually below — App Router needs explicit tracking
    capture_pageleave: true,
    persistence: "localStorage+cookie",
  });
}

/**
 * Captures $pageview events on Next.js App Router navigation.
 * useSearchParams() suspends, so it's wrapped in a Suspense boundary.
 */
function TrackPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    let url = window.origin + pathname;
    const q = searchParams?.toString();
    if (q) url = `${url}?${q}`;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

export function PostHogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Provider client={posthog}>
      <Suspense fallback={null}>
        <TrackPageView />
      </Suspense>
      {children}
    </Provider>
  );
}
