-- Slice D (doc 26 §2D): the student portal — third role, tutor-provisioned
-- username+password credentials, and the audit trail that holding minors'
-- credentials makes non-optional (doc 35b §5.5).
--
-- DATA-PRESERVING BY CONSTRUCTION (the standing rule since C.5 — prod holds
-- Fatima's real students/lessons/homework, so db:seed is dev-only and every
-- prod schema change is a migration):
--   * two brand-new tables — nothing existing is touched;
--   * two NULLABLE columns on `students` (user_id, username) — every existing
--     row stays valid, and NULL simply means "no portal login yet", which is
--     exactly true of all of them until the tutor provisions one.
-- No backfill, no NOT NULL default, no drop. Reviewed and left in Drizzle's
-- emitted order: the unique anchors here are on the same table as the columns
-- (unlike 0001, where composite FKs had to be hand-reordered after them).
--
-- students.user_id is UNIQUE globally, which is load-bearing for tenant
-- coherence, not just tidiness: one auth user ↔ one students row ↔ one tenant,
-- so a student JWT can never resolve to a second tenant's student. See
-- schema.ts + policies.sql §1 current_student_ids().
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_login_attempts" (
	"username" text PRIMARY KEY NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_idx" ON "audit_log" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "student_login_attempts_locked_idx" ON "student_login_attempts" USING btree ("locked_until");--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_unique" UNIQUE("user_id");--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_username_unique" UNIQUE("username");