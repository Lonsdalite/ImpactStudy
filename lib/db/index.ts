import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/lib/env.server";
import * as schema from "./schema";

/**
 * Drizzle ORM client.
 *
 * Uses Supabase's connection pooler (port 6543, transaction mode), which is
 * the Vercel-serverless-friendly endpoint. `prepare: false` is required for
 * transaction-mode pooling — Supabase rejects prepared statements there.
 *
 * Import from server components, route handlers, server actions, Inngest jobs.
 * NEVER import from client components — the "server-only" guard will block it.
 */

const client = postgres(serverEnv.DATABASE_URL, {
  prepare: false,
  max: 10, // pool size; tuned for Vercel Hobby/Pro
});

export const db = drizzle(client, { schema });
export { schema };
