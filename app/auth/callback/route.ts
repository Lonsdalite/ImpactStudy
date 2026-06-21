import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Supabase auth callback — handles BOTH flows:
 *
 * 1. Email magic link (PRIMARY) — `token_hash` + `type` → verifyOtp().
 *    No PKCE code-verifier cookie required, so it survives the link being
 *    opened in a different tab/app/webview. This is the robust SSR pattern.
 *    Requires the Supabase "Magic Link" email template to point here with
 *    token_hash (see lib/db/policies.sql sibling note / Day 3 doc).
 *
 * 2. OAuth / PKCE (FUTURE — Google/Apple) — `code` → exchangeCodeForSession().
 *    Kept so social login works when we add it in Phase 1.
 *
 * On success → redirect to ?next= (default /dashboard).
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const next = requestUrl.searchParams.get("next") ?? "/dashboard";

  const redirectToLogin = (message: string) => {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("message", message);
    return NextResponse.redirect(loginUrl);
  };

  const supabase = await createClient();
  let error: { message: string } | null = null;

  if (tokenHash && type) {
    // Magic-link / email OTP flow — no verifier needed.
    ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
  } else if (code) {
    // OAuth / PKCE flow.
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else {
    return redirectToLogin("Sign-in link is missing or expired. Try again.");
  }

  if (error) {
    return redirectToLogin(`Sign-in failed: ${error.message}`);
  }

  // Handle deploy behind reverse proxy (Vercel sets x-forwarded-host correctly).
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocalEnv = process.env.NODE_ENV === "development";
  if (!isLocalEnv && forwardedHost) {
    return NextResponse.redirect(`https://${forwardedHost}${next}`);
  }
  return NextResponse.redirect(new URL(next, request.url));
}
