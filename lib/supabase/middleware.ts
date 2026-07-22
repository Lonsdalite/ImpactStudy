import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

/**
 * Session refresh helper for root middleware.
 *
 * - Refreshes Supabase session cookies on every request that matches.
 * - Protects authenticated routes by redirecting unauthenticated users
 *   to /login.
 *
 * Critical: do NOT introduce Server Component-style cookies reads here.
 * Middleware uses the request/response cookies API.
 */

// Routes that require an authenticated user. Anything not here is public.
// /portal is the student surface (Slice D) — same auth requirement; WHICH of the
// two surfaces you belong on is decided by role in the layouts (a student is
// bounced from /dashboard, staff/parents from /portal), because that needs a DB
// round-trip for the membership and this runs on every request.
const PROTECTED_PREFIXES = ["/dashboard", "/tenant-select", "/portal"];

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: getUser() validates the session server-side. Don't use getSession().
  // Timed inline rather than via lib/perf: that module is `server-only` and this
  // runs in the middleware runtime (doc 42 baseline instrumentation).
  const tUser = performance.now();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (process.env.PERF_LOG !== "0") {
    console.log(
      `[perf] middleware.getUser ${(performance.now() - tUser).toFixed(0)}ms path=${request.nextUrl.pathname}`,
    );
  }

  if (isProtectedPath(request.nextUrl.pathname) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
