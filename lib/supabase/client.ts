import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";

/**
 * Browser Supabase client — uses the publishable key (RLS-enforced).
 * Safe to call from client components and client-side actions.
 */
export function createClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
