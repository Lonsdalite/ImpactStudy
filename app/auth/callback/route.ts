import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Supabase magic-link / OAuth callback.
 *
 * Email link flow:
 *   1. User requests magic link via /login (signInWithOtp)
 *   2. Supabase email template links to:
 *        https://<project>.supabase.co/auth/v1/verify?token=...&type=magiclink&redirect_to=<our-callback>
 *   3. Supabase verifies the token, redirects to our callback with ?code=<authCode>
 *   4. We exchange the code for a session cookie via exchangeCodeForSession
 *   5. Redirect to ?next= (or /dashboard by default)
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") ?? "/dashboard";

  if (!code) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "message",
      "Sign-in link is missing or expired. Try again.",
    );
    return NextResponse.redirect(loginUrl);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("message", `Sign-in failed: ${error.message}`);
    return NextResponse.redirect(loginUrl);
  }

  // Handle deploy behind reverse proxy (Vercel sets x-forwarded-host correctly).
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocalEnv = process.env.NODE_ENV === "development";
  if (!isLocalEnv && forwardedHost) {
    return NextResponse.redirect(`https://${forwardedHost}${next}`);
  }
  return NextResponse.redirect(new URL(next, request.url));
}
