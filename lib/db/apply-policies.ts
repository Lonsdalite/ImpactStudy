/**
 * Apply lib/db/policies.sql to the database, then ASSERT that row-level
 * security is enabled on every public table (Slice B.5 / Fable §1 P1 — an
 * RLS-off table on the PostgREST path is a fully open table, so this fails
 * loudly instead of trusting convention).
 *
 *   pnpm db:policies        (also chained onto pnpm db:migrate)
 *
 * Runs AFTER `pnpm db:migrate` (the tables must exist first). Idempotent —
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

    // RLS-on assertion: every table in public must have rowsecurity. Views
    // (parent_lessons, parent_corrections) live in pg_views, not pg_tables, so
    // they don't trip this.
    const open = await sql<{ tablename: string }[]>`
      select tablename
      from pg_tables
      where schemaname = 'public' and not rowsecurity
      order by tablename
    `;
    if (open.length > 0) {
      console.error(
        `❌ RLS IS OFF on ${open.length} public table(s): ` +
          open.map((r) => r.tablename).join(", ") +
          "\n   Every public table must have row-level security enabled. " +
          "Fix policies.sql (§2 / the table's section) and re-run pnpm db:policies.",
      );
      process.exitCode = 1;
      return;
    }
    console.log("✅ RLS is enabled on every public table");
  } catch (err) {
    console.error("❌ Failed to apply policies.sql:\n", err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

void main();
