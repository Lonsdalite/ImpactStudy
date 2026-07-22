import "server-only";

/**
 * Tiny server-side timing helpers (Slice C.5 item d — "measure first"). Kept in
 * their own module so the Server Component call sites read as ordinary function
 * calls rather than inline `performance.now()` (which the react-hooks purity
 * lint flags as an impure call during render). Server-only: never bundled to the
 * client. Wall-clock ms, for coarse before/after comparisons in the server log.
 */
export function nowMs(): number {
  return performance.now();
}

/** Milliseconds elapsed since `start`, rounded, as a string ("123"). */
export function sinceMs(start: number): string {
  return (performance.now() - start).toFixed(0);
}

/**
 * Structured one-line timing log (doc 42 — performance/latency pass).
 *
 * Vercel groups runtime log lines by request id, so one navigation reads as a
 * stack of `[perf]` lines: how long each auth hop and each query batch took, and
 * how many times the request paid for the same one. That count is half the
 * point — the auth-dedup fix is judged by whether `tenant.getUser` stops
 * appearing three times per navigation.
 *
 * `PERF_LOG=0` turns it off without a code change; otherwise it is on
 * everywhere, because the numbers we care about only exist in production.
 */
export function perfLog(label: string, startedAt: number, extra?: string): void {
  if (process.env.PERF_LOG === "0") return;
  const ms = (performance.now() - startedAt).toFixed(0);
  console.log(`[perf] ${label} ${ms}ms${extra ? ` ${extra}` : ""}`);
}

/** Time an awaited call, log it under `label`, and return its value. */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    perfLog(label, t0);
  }
}
