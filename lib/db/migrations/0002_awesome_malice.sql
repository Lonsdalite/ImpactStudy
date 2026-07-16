-- Slice C.5 (doc 36 item b): subject-aware correction output. Adds the
-- `correction_mode` enum + a `mode` column on corrections. DEFAULT 'marking'
-- NOT NULL backfills every existing row to the pre-C.5 behaviour, so the
-- maths/marking path is untouched. The extended language-mode item fields
-- (issueType/label/original/suggestion) ride the existing `items` jsonb — no
-- schema change needed for those (schemaless).
CREATE TYPE "public"."correction_mode" AS ENUM('marking', 'language');--> statement-breakpoint
ALTER TABLE "corrections" ADD COLUMN "mode" "correction_mode" DEFAULT 'marking' NOT NULL;