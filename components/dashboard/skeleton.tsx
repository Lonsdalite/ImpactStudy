import { cn } from "@/lib/utils";

/**
 * Loading-state primitives (doc 44 — perceived-latency pass).
 *
 * These exist because of a measurement, not a taste call. Every dashboard route
 * is dynamic, and Next.js only paints a navigation once the server responds — so
 * with no Suspense boundary anywhere, clicking a link left the OLD page on
 * screen, unchanged, for the whole round trip. From outside Australia that is
 * the better part of a second of "did my click register?". A route's
 * `loading.tsx` fixes both halves of that: the shell paints instantly, and
 * `<Link>` prefetch starts working again (for a dynamic route, Next prefetches
 * exactly as far as the nearest loading boundary — with none, it prefetched
 * nothing).
 *
 * Deliberately quiet: brand-mist blocks at low opacity, one shared pulse. A
 * skeleton that flashes or jumps costs more attention than the wait it covers.
 */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-brand-mist/60", className)}
      aria-hidden="true"
    />
  );
}

/** The page heading block every dashboard route opens with. */
export function SkeletonHeader() {
  return (
    <>
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-3 h-9 w-56" />
      <Skeleton className="mt-3 h-4 w-full max-w-md" />
    </>
  );
}

/** A row of stat tiles (overview, billing, student record). */
export function SkeletonTiles({ count = 3 }: { count?: number }) {
  return (
    <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col rounded-2xl border border-brand-mist bg-white p-4 sm:p-5"
        >
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-3 h-8 w-24" />
          <Skeleton className="mt-2 h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/** A stack of list cards (students, billing, homework, reports). */
export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="mt-6 space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-brand-mist bg-white p-4 sm:p-5"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-56" />
            </div>
            <Skeleton className="h-5 w-20 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The whole content column. `srLabel` is the only thing a screen reader gets —
 * the blocks themselves are aria-hidden, so the status message is what
 * announces the wait.
 */
export function SkeletonPage({
  children,
  maxWidth = "max-w-4xl",
  srLabel = "Loading",
}: {
  children: React.ReactNode;
  maxWidth?: string;
  srLabel?: string;
}) {
  return (
    <main className="flex-1 px-6 py-10 md:px-10">
      <div className={cn("mx-auto", maxWidth)}>
        <span role="status" aria-live="polite" className="sr-only">
          {srLabel}
        </span>
        {children}
      </div>
    </main>
  );
}
