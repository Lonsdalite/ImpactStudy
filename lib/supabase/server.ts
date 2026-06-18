import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Server Supabase client — reads session from cookies via next/headers.
 * Uses the publishable key (RLS-enforced); for service-role operations use
 * createAdminClient (added when we need admin ops).
 *
 * Note: cookies() is async in Next.js 15+.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components can't set cookies. The session refresh in
            // lib/supabase/middleware.ts handles this case.
          }
        },
      },
    },
  );
}
