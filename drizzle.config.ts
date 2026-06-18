import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Drizzle Kit doesn't auto-load .env.local. Explicit load:
config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Check .env.local — drizzle-kit can't connect without it.",
  );
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  schemaFilter: ["public"],
  verbose: true,
  strict: true,
});
