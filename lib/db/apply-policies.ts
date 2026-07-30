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

    // Parent-safe-view assertion (§11f). parent_lessons / parent_corrections are
    // definer-style ON PURPOSE — the base tables are staff-only for SELECT, so
    // the view owner's RLS bypass is what lets a parent read their own rows at
    // all. (Supabase's Security Advisor flags these as "Security Definer View";
    // that finding is the FIX for doc 35b's P1, not a bug. Do NOT set
    // security_invoker = true — parents would get zero rows and the portal would
    // silently go blank.)
    //
    // The cost of that pattern: the view's WHERE clause IS the whole security
    // boundary, with no RLS policy underneath to catch a mistake. So adding a
    // forbidden column to either view would leak it with nothing to stop it.
    // This asserts that can't happen quietly.
    const forbidden: Record<string, string[]> = {
      parent_lessons: ["note", "fee_override_cents"],
      parent_corrections: ["items", "stats"],
    };

    const present = await sql<{ table_name: string; column_name: string }[]>`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = any(${Object.keys(forbidden)})
      order by table_name, column_name
    `;

    const missingViews = Object.keys(forbidden).filter(
      (v) => !present.some((r) => r.table_name === v),
    );
    if (missingViews.length > 0) {
      console.error(
        `❌ Parent-safe view(s) missing: ${missingViews.join(", ")}\n` +
          "   Parents read their lessons/corrections through these. Without " +
          "them the parent portal reads nothing. See policies.sql §11f.",
      );
      process.exitCode = 1;
      return;
    }

    const leaked = present.filter((r) =>
      forbidden[r.table_name]?.includes(r.column_name),
    );
    if (leaked.length > 0) {
      console.error(
        `❌ PARENT-SAFE VIEW LEAK — ${leaked.length} forbidden column(s) exposed:\n` +
          leaked.map((r) => `   ${r.table_name}.${r.column_name}`).join("\n") +
          "\n   These views are SECURITY DEFINER, so RLS will NOT stop this — " +
          "the column is readable by every parent. Doc 20 §7.6 (lesson notes " +
          "stay internal) and doc 26 §2D (feedback, never grades). Remove the " +
          "column from the view in policies.sql §11f.",
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      "✅ Parent-safe views expose no forbidden columns (note, fee_override_cents, items, stats)",
    );
  } catch (err) {
    console.error("❌ Failed to apply policies.sql:\n", err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

void main();
