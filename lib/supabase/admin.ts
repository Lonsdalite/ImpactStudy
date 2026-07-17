import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";

/**
 * Service-role Supabase client — BYPASSES RLS AND OWNS THE AUTH ADMIN API.
 *
 * Read this before using it. Everything else in the app reaches Supabase on the
 * publishable key, where RLS is the enforcement (lib/supabase/server.ts), or on
 * Drizzle, where tenant_id is filtered in code (doc 06 §3). This client has
 * neither guard: it can read and write every row of every tenant, and it can mint
 * and reset auth credentials.
 *
 * It exists for exactly one thing (doc 35b §5.5): creating and resetting STUDENT
 * portal credentials, which is only possible via `auth.admin`. There is no
 * RLS-scoped way to do that — the operation is inherently privileged.
 *
 * Rules for every caller, no exceptions:
 *   1. `server-only` (enforced by the import above) — a service key in a client
 *      bundle is a total compromise of every tenant, not a bug.
 *   2. requireStaff() FIRST. This client does not know who is asking; the caller
 *      must. Scope every operation to the resolved active tenant explicitly.
 *   3. Audit it (lib/audit.ts). Privileged + unlogged = unanswerable.
 *   4. Do not reach for it to "make a query work". A row this client can see but
 *      the RLS client cannot is a policy gap to fix in policies.sql, not to route
 *      around here.
 *
 * No session, no cookie persistence: this is a bare API caller, never a user.
 */
export function createAdminClient() {
  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
