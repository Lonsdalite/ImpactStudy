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
