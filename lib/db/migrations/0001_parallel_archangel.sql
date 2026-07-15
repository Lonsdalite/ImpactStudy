-- Slice B.5 hardening (Fable review, docs 35b/35c):
--   A3 P0-1 tenant coherence — unique(tenant_id, id) anchors + composite FKs
--     (tenant_id, <x>_id) → parent(tenant_id, id) so cross-tenant child rows
--     are unrepresentable.
--   A1 P0-2 occurrence identity — partial unique index on recurring lessons
--     (custom SQL at the bottom; NULLS NOT DISTINCT + WHERE aren't expressible
--     in Drizzle).
--   A6 — lessons.enrollment_id ON DELETE SET NULL (column list) so deleting an
--     enrollment never deletes billed history.
-- Hand-reordered from drizzle-kit output: the UNIQUE anchors must exist before
-- the composite FKs that reference them.
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_tenant_id_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "assignments" DROP CONSTRAINT "assignments_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "assignments" DROP CONSTRAINT "assignments_enrollment_id_enrollments_id_fk";
--> statement-breakpoint
ALTER TABLE "corrections" DROP CONSTRAINT "corrections_submission_id_submissions_id_fk";
--> statement-breakpoint
ALTER TABLE "corrections" DROP CONSTRAINT "corrections_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "enrollment_schedules" DROP CONSTRAINT "enrollment_schedules_enrollment_id_enrollments_id_fk";
--> statement-breakpoint
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "lessons" DROP CONSTRAINT "lessons_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "lessons" DROP CONSTRAINT "lessons_enrollment_id_enrollments_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "reports" DROP CONSTRAINT "reports_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "student_parents" DROP CONSTRAINT "student_parents_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "submissions" DROP CONSTRAINT "submissions_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_tenant_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_tenant_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_tenant_submission_fk" FOREIGN KEY ("tenant_id","submission_id") REFERENCES "public"."submissions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_schedules" ADD CONSTRAINT "enrollment_schedules_tenant_enrollment_fk" FOREIGN KEY ("tenant_id","enrollment_id") REFERENCES "public"."enrollments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_tenant_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_tenant_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_parents" ADD CONSTRAINT "student_parents_tenant_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_tenant_student_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Custom SQL (outside Drizzle's dialect — documented in lib/db/schema.ts):
-- ---------------------------------------------------------------------------
-- A6: tenant-coherent enrollment links that SET NULL only the enrollment column
-- on enrollment delete (PG15 column-list form). Cascade would delete the billed
-- ledger; a bare SET NULL would try to null the NOT NULL tenant_id.
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_tenant_enrollment_fk" FOREIGN KEY ("tenant_id","enrollment_id") REFERENCES "public"."enrollments"("tenant_id","id") ON DELETE SET NULL ("enrollment_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_tenant_enrollment_fk" FOREIGN KEY ("tenant_id","enrollment_id") REFERENCES "public"."enrollments"("tenant_id","id") ON DELETE SET NULL ("enrollment_id") ON UPDATE no action;--> statement-breakpoint
-- A1 P0-2: occurrence identity for recurring lessons. One row per
-- (enrollment, date, starts_at) where origin='recurring' — a double-tap on
-- "Mark this week" (or two tabs) can insert the same occurrence only once.
-- NULLS NOT DISTINCT so legacy register rows (starts_at IS NULL) are covered
-- too. Makeups/one-offs (origin <> 'recurring') stay keyed by id, and orphaned
-- ledger rows (enrollment_id nulled by an enrollment delete) are exempt so two
-- orphans on one date can never collide.
CREATE UNIQUE INDEX "lessons_recurring_occurrence_uq" ON "lessons" ("enrollment_id","date","starts_at") NULLS NOT DISTINCT WHERE "origin" = 'recurring' AND "enrollment_id" IS NOT NULL;