import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

/**
 * TEMPORARY latency probe (doc 42 — performance/latency pass). DELETE ME.
 *
 * Reports which region the function actually ran in, and times a handful of
 * SEQUENTIAL round trips to Supabase from inside that region. That is the one
 * number the whole pass turns on: every `getUser()` and every PostgREST query a
 * page makes costs one of these, and a dashboard load stacks 5–9 of them.
 *
 * Deliberately measures the same two hops the app uses:
 *   - `/auth/v1/health` — the Supabase Auth origin that `getUser()` validates
 *     against (a network call, not a local JWT decode).
 *   - a PostgREST select — the data path. Uses the publishable key with no
 *     session, so RLS returns zero rows: we are timing the round trip, not a
 *     query plan (and no data can leak through it).
 *
 * Unauthenticated by necessity (it must be curl-able for scripted before/after
 * runs) so it is gated on a shared token and emits nothing but durations.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROUNDS = 5;

async function timeIt(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return Math.round((performance.now() - t0) * 10) / 10;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!process.env.PERF_PROBE_TOKEN || token !== process.env.PERF_PROBE_TOKEN) {
    return new NextResponse("Not found", { status: 404 });
  }

  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // First call carries DNS + TCP + TLS; the rest reuse the warm connection.
  const authCold = await timeIt(() => fetch(`${base}/auth/v1/health`, { cache: "no-store" }));
  const authWarm: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    authWarm.push(await timeIt(() => fetch(`${base}/auth/v1/health`, { cache: "no-store" })));
  }

  const restCold = await timeIt(() =>
    fetch(`${base}/rest/v1/tenants?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    }),
  );
  const restWarm: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    restWarm.push(
      await timeIt(() =>
        fetch(`${base}/rest/v1/tenants?select=id&limit=1`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          cache: "no-store",
        }),
      ),
    );
  }

  const median = (xs: number[]) =>
    [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

  return NextResponse.json(
    {
      region: process.env.VERCEL_REGION ?? "unknown",
      env: process.env.VERCEL_ENV ?? "unknown",
      supabaseHost: new URL(base).host,
      authCold,
      authWarm,
      authWarmMedian: median(authWarm),
      restCold,
      restWarm,
      restWarmMedian: median(restWarm),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
