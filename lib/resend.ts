import "server-only";
import { Resend } from "resend";
import { serverEnv } from "@/lib/env.server";

/**
 * Resend client for transactional email.
 *
 * NOT used for Supabase magic-link emails (those go via Supabase's built-in
 * SMTP). We swap Supabase Auth's email provider to Resend at Week 8 of
 * Phase 1 once we've verified the custom domain.
 *
 * Currently unused — first send will be the weekly parent report in Phase 1.
 */
export const resend = new Resend(serverEnv.RESEND_API_KEY);

export const FROM_EMAIL = serverEnv.RESEND_FROM_EMAIL;
