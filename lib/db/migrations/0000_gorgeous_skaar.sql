CREATE TYPE "public"."assignment_status" AS ENUM('assigned', 'submitted', 'corrected', 'returned', 'archived');--> statement-breakpoint
CREATE TYPE "public"."billing_cycle" AS ENUM('weekly', 'fortnightly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."corpus_kind" AS ENUM('platform_baseline', 'tenant_uploaded');--> statement-breakpoint
CREATE TYPE "public"."correction_status" AS ENUM('draft', 'released');--> statement-breakpoint
CREATE TYPE "public"."enrollment_mode" AS ENUM('one_to_one', 'group');--> statement-breakpoint
CREATE TYPE "public"."lesson_origin" AS ENUM('recurring', 'makeup', 'oneoff');--> statement-breakpoint
CREATE TYPE "public"."lesson_status" AS ENUM('scheduled', 'attended', 'late', 'absent', 'cancelled', 'rescheduled');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card', 'payid', 'transfer', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('draft', 'approved', 'sent');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'tutor', 'parent', 'student');--> statement-breakpoint
CREATE TYPE "public"."uploader_role" AS ENUM('tutor', 'student', 'parent');--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid,
	"subject_id" uuid,
	"worksheet_id" uuid,
	"title" text NOT NULL,
	"status" "assignment_status" DEFAULT 'assigned' NOT NULL,
	"due_date" date,
	"order_index" integer DEFAULT 1000 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "corpus_kind" NOT NULL,
	"name" text NOT NULL,
	"region" text,
	"syllabus" text,
	"license" text,
	"url" text,
	"tenant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corpus_sources_kind_tenant_ck" CHECK (("corpus_sources"."kind" = 'platform_baseline' AND "corpus_sources"."tenant_id" IS NULL) OR ("corpus_sources"."kind" = 'tenant_uploaded' AND "corpus_sources"."tenant_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "correction_status" DEFAULT 'draft' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"voiced_note" text,
	"stats" jsonb,
	"model" text,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corrections_submission_unique" UNIQUE("submission_id")
);
--> statement-breakpoint
CREATE TABLE "enrollment_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"duration_override" integer,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_schedules_weekday_ck" CHECK ("enrollment_schedules"."weekday" >= 0 AND "enrollment_schedules"."weekday" <= 6)
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"mode" "enrollment_mode" NOT NULL,
	"price_list_item_id" uuid,
	"hourly_rate_cents" integer NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"session_minutes" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid,
	"date" date NOT NULL,
	"starts_at" timestamp with time zone,
	"status" "lesson_status" NOT NULL,
	"origin" "lesson_origin" DEFAULT 'recurring' NOT NULL,
	"rescheduled_to_lesson_id" uuid,
	"duration_minutes" integer DEFAULT 0 NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"fee_override_cents" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_user_unique" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"paid_on" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"year_level" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"mode" "enrollment_mode" NOT NULL,
	"hourly_rate_cents" integer NOT NULL,
	"default_session_minutes" integer NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_items_unique" UNIQUE("tenant_id","year_level","subject_id","mode")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "report_status" DEFAULT 'draft' NOT NULL,
	"greeting" text,
	"body" text NOT NULL,
	"signoff" text,
	"model" text,
	"stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"sent_at" timestamp with time zone,
	CONSTRAINT "reports_student_period_unique" UNIQUE("student_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "student_parents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"parent_user_id" uuid NOT NULL,
	"relationship" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "student_parents_unique" UNIQUE("student_id","parent_user_id")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"year_level" text,
	"active" boolean DEFAULT true NOT NULL,
	"billing_cycle" "billing_cycle" DEFAULT 'monthly' NOT NULL,
	"billing_anchor" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subjects_tenant_name_unique" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"assignment_id" uuid,
	"subject_id" uuid,
	"uploader_role" "uploader_role" DEFAULT 'tutor' NOT NULL,
	"uploaded_by" uuid,
	"pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_corpus_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"corpus_source_id" uuid NOT NULL,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_corpus_sub_unique" UNIQUE("tenant_id","corpus_source_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"brand_color" text DEFAULT '#3D2C4F' NOT NULL,
	"voice_signature" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "worksheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subject_id" uuid,
	"year_level" text,
	"topic" text,
	"order_index" integer,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"file_mime" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_worksheet_id_worksheets_id_fk" FOREIGN KEY ("worksheet_id") REFERENCES "public"."worksheets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus_sources" ADD CONSTRAINT "corpus_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_schedules" ADD CONSTRAINT "enrollment_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_schedules" ADD CONSTRAINT "enrollment_schedules_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_price_list_item_id_price_list_items_id_fk" FOREIGN KEY ("price_list_item_id") REFERENCES "public"."price_list_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_rescheduled_to_lesson_id_lessons_id_fk" FOREIGN KEY ("rescheduled_to_lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_parents" ADD CONSTRAINT "student_parents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_parents" ADD CONSTRAINT "student_parents_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_parents" ADD CONSTRAINT "student_parents_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_corpus_subscriptions" ADD CONSTRAINT "tenant_corpus_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_corpus_subscriptions" ADD CONSTRAINT "tenant_corpus_subscriptions_corpus_source_id_corpus_sources_id_fk" FOREIGN KEY ("corpus_source_id") REFERENCES "public"."corpus_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksheets" ADD CONSTRAINT "worksheets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksheets" ADD CONSTRAINT "worksheets_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignments_tenant_idx" ON "assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "assignments_student_idx" ON "assignments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "assignments_status_idx" ON "assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "corpus_sources_tenant_idx" ON "corpus_sources" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "corpus_sources_kind_idx" ON "corpus_sources" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "corrections_tenant_idx" ON "corrections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "corrections_student_idx" ON "corrections" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "corrections_status_idx" ON "corrections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "enrollment_schedules_tenant_idx" ON "enrollment_schedules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "enrollment_schedules_enrollment_idx" ON "enrollment_schedules" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "enrollments_tenant_idx" ON "enrollments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "enrollments_student_idx" ON "enrollments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "enrollments_subject_idx" ON "enrollments" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "lessons_tenant_idx" ON "lessons" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lessons_student_idx" ON "lessons" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "lessons_enrollment_idx" ON "lessons" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "lessons_date_idx" ON "lessons" USING btree ("date");--> statement-breakpoint
CREATE INDEX "memberships_tenant_idx" ON "memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_tenant_idx" ON "payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payments_student_idx" ON "payments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "payments_paid_on_idx" ON "payments" USING btree ("paid_on");--> statement-breakpoint
CREATE INDEX "price_list_items_tenant_idx" ON "price_list_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "price_list_items_subject_idx" ON "price_list_items" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "reports_tenant_idx" ON "reports" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "reports_student_idx" ON "reports" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "student_parents_tenant_idx" ON "student_parents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "students_tenant_idx" ON "students" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "subjects_tenant_idx" ON "subjects" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "submissions_tenant_idx" ON "submissions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "submissions_student_idx" ON "submissions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "submissions_assignment_idx" ON "submissions" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "tenant_corpus_sub_tenant_idx" ON "tenant_corpus_subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "worksheets_tenant_idx" ON "worksheets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "worksheets_subject_idx" ON "worksheets" USING btree ("subject_id");