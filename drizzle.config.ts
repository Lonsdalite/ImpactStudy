import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Drizzle Kit doesn't auto-load .env.local. Explicit load:
config({ path: ".env.local" });

// DDL prefers the DIRECT (non-pooler) connection, falling back to DATABASE_URL.
// DATABASE_URL is the session pooler, which the running app shares and which caps
// at 15 clients: with a `pnpm dev` server open, migrations lose the race for a
// connection and fail with EMAXCONNSESSION (drizzle-kit swallows the error behind
// its spinner, so it just looks like a hang). apply-policies.ts prefers DIRECT_URL
// for the same reason — this keeps the two halves of `db:migrate` on one path.
const migrationUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!migrationUrl) {
  throw new Error(
    "Neither DIRECT_URL nor DATABASE_URL is set. Check .env.local — drizzle-kit can't connect without one.",
  );
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: migrationUrl,
  },
  schemaFilter: ["public"],
  verbose: true,
  strict: true,
});
