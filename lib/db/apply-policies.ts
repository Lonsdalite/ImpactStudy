/**
 * Apply lib/db/policies.sql to the database.
 *
 *   pnpm db:policies
 *
 * Runs AFTER `pnpm db:push` (the corpus tables must exist first). Idempotent —
 * re-run any time policies.sql changes. Prefers DIRECT_URL (session pooler,
 * 5432) for DDL; falls back to DATABASE_URL. No psql dependency.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ Missing DIRECT_URL / DATABASE_URL in .env.local");
    process.exit(1);
  }
  if (!process.env.DIRECT_URL) {
    console.warn(
      "⚠️  DIRECT_URL not set — using DATABASE_URL. If DDL fails on the " +
        "transaction pooler, add DIRECT_URL (session pooler, port 5432).",
    );
  }

  const sqlText = readFileSync(
    resolve(process.cwd(), "lib/db/policies.sql"),
    "utf8",
  );

  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    // .simple() → simple query protocol, which allows the multi-statement file
    // (functions, triggers, policies) to run in one round-trip.
    await sql.unsafe(sqlText).simple();
    console.log("✅ policies.sql applied");
  } catch (err) {
    console.error("❌ Failed to apply policies.sql:\n", err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

void main();
