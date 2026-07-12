import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  date,
  jsonb,
  pgEnum,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type { VoiceSignature } from "@/lib/voice-types";
import type {
  SubmissionPage,
  CorrectionItem,
  CorrectionStats,
  UploaderRole,
} from "@/lib/homework-types";

/**
 * Roles inside a tenant. A user can have different roles in different tenants
 * via the memberships table.
 *
 * - owner   : created the tenant, full control + billing
 * - admin   : full control, no billing
 * - tutor   : runs lessons, creates content
 * - parent  : views their child(ren)'s progress, receives heartbeat
 * - student : uses Tutor-AI, completes practice
 */
export const roleEnum = pgEnum("role", [
  "owner",
  "admin",
  "tutor",
  "parent",
  "student",
]);

// How often a student is billed. Anchored at their billing_anchor (join) date.
export const billingCycleEnum = pgEnum("billing_cycle", [
  "weekly",
  "fortnightly",
  "monthly",
]);

// Delivery mode of an enrollment / price-list row. Group price is flat per
// student (not a split); group size is not modelled yet (doc 26 §2, deferred).
export const enrollmentModeEnum = pgEnum("enrollment_mode", [
  "one_to_one",
  "group",
]);

// ---------- homework / AI correction (Slice C — doc 26 §2C) ----------
// Per-student assignment pipeline. The wide enum is billing/state-safe and
// leaves room for D's student-facing flow: assigned -> submitted -> corrected
// -> returned, plus `archived` for cancel/tidy. "up next" is derived from
// order_index over the not-yet-returned rows, not a separate status.
export const assignmentStatusEnum = pgEnum("assignment_status", [
  "assigned",
  "submitted",
  "corrected",
  "returned",
  "archived",
]);

// A correction is DRAFT (AI-written, tutor-only) until the tutor RELEASES it.
// Same trust spine as reports (draft -> sent): review-before-release is
// non-negotiable (doc 26 §2C). A parent may only ever read a released one.
export const correctionStatusEnum = pgEnum("correction_status", [
  "draft",
  "released",
]);

// Who uploaded a submission. Polymorphic in the model; pilot = tutor only.
// student/parent uploads arrive with Slice D.
export const uploaderRoleEnum = pgEnum("uploader_role", [
  "tutor",
  "student",
  "parent",
]);

// ---------- tenants ----------
// One tenant per tutoring practice. Fatima is tenant #1.
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  brandColor: text("brand_color").default("#3D2C4F").notNull(),
  // The tutor's voice signature (Pedagogy Style Guide). NULL until captured;
  // CEQR falls back to a default voice when null. See lib/voice-types.ts.
  voiceSignature: jsonb("voice_signature").$type<VoiceSignature>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------- users ----------
// Mirrors auth.users from Supabase Auth. The id column is the auth.users.id
// (UUID). We do NOT auto-generate it — Supabase inserts via a trigger or our
// own app code on first login.
export const users = pgTable("users", {
  id: uuid("id").primaryKey(), // FK to auth.users(id), no default
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------- memberships ----------
// Joins users to tenants with a role. A user can be in multiple tenants;
// the tenant-selector picks which one to act under.
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique("memberships_tenant_user_unique").on(t.tenantId, t.userId),
    index("memberships_tenant_idx").on(t.tenantId),
    index("memberships_user_idx").on(t.userId),
  ],
);

// ---------- students ----------
// Belong to a tenant. Linked to one or more parent users via student_parents.
export const students = pgTable(
  "students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    // The join key into the price catalog (price_list_items). e.g. 'Y6'.
    yearLevel: text("year_level"), // 'Y3', 'Y4', etc.
    active: boolean("active").default(true).notNull(),
    // Billing cadence + the date cycles are counted from (their start/join
    // date). Together these let the app compute each student's current period
    // and next-due date — no two students need the same cycle.
    billingCycle: billingCycleEnum("billing_cycle").default("monthly").notNull(),
    billingAnchor: date("billing_anchor"), // 'YYYY-MM-DD'; null = use created_at
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("students_tenant_idx").on(t.tenantId)],
);

// ---------- student_parents ----------
// Many-to-many: a student can have multiple parents/guardians; a parent can
// have multiple students. One marked as is_primary for default notifications.
export const studentParents = pgTable(
  "student_parents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    parentUserId: uuid("parent_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    relationship: text("relationship"), // 'mother', 'father', 'guardian'
    isPrimary: boolean("is_primary").default(false).notNull(),
  },
  (t) => [
    unique("student_parents_unique").on(t.studentId, t.parentUserId),
    index("student_parents_tenant_idx").on(t.tenantId),
  ],
);

// ---------- subjects ----------
// Tenant-scoped, extensible list of subjects Fatima teaches. Seed: English,
// Physics, Chemistry, Maths. A subject is the "what" half of an enrollment and
// the price-catalog key (doc 26 §2 / doc 27 §2.2).
export const subjects = pgTable(
  "subjects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // "Maths"
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique("subjects_tenant_name_unique").on(t.tenantId, t.name),
    index("subjects_tenant_idx").on(t.tenantId),
  ],
);

// ---------- price_list_items ----------
// Fatima-editable catalog. One row per (year level × subject × mode) →
// hourly rate + default session length. She adds a row when a new combo
// appears; tenant #2 gets its own catalog (doc 26 §2 / doc 27 §2.2).
//   e.g. Y6 Physics 1:1 → 6000c/hr, 60 min;  Y6 Maths group → 4000c/hr, 90 min
export const priceListItems = pgTable(
  "price_list_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    yearLevel: text("year_level").notNull(), // "Y6"
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    mode: enrollmentModeEnum("mode").notNull(),
    hourlyRateCents: integer("hourly_rate_cents").notNull(), // 6000 = $60/hr
    // Mode-based default set by the app (1:1→60, group→90), NOT hardcoded here —
    // a value so other tenants and one-off long classes need no code change.
    defaultSessionMinutes: integer("default_session_minutes").notNull(),
    currency: text("currency").default("AUD").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique("price_list_items_unique").on(
      t.tenantId,
      t.yearLevel,
      t.subjectId,
      t.mode,
    ),
    index("price_list_items_tenant_idx").on(t.tenantId),
    index("price_list_items_subject_idx").on(t.subjectId),
  ],
);

// ---------- enrollments ----------
// The unit of everything (doc 26 §0/§2). student × subject × mode, inheriting
// hourly rate (via the resolved price_list_item) + session length. Its schedule
// (Bucket B) and assignments (Bucket C) hang off this row.
export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    mode: enrollmentModeEnum("mode").notNull(),
    // Resolved at creation from (student.year_level, subject, mode). Nullable so
    // deleting a catalog row doesn't cascade-delete the enrollment; the billed
    // rate is snapshotted onto each lesson anyway.
    priceListItemId: uuid("price_list_item_id").references(
      () => priceListItems.id,
      { onDelete: "set null" },
    ),
    // Snapshot of the hourly rate at enrollment time — survives a catalog edit.
    hourlyRateCents: integer("hourly_rate_cents").notNull(),
    currency: text("currency").default("AUD").notNull(),
    // Inherited default block length; a per-slot / long-class override lives on
    // the lesson (duration_minutes).
    sessionMinutes: integer("session_minutes").notNull(),
    active: boolean("active").default(true).notNull(),
    startDate: date("start_date"), // 'YYYY-MM-DD'; null = from created_at
    endDate: date("end_date"), // null = ongoing
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("enrollments_tenant_idx").on(t.tenantId),
    index("enrollments_student_idx").on(t.studentId),
    index("enrollments_subject_idx").on(t.subjectId),
  ],
);

// ---------- corpus_sources ----------
// Where a content chunk came from. Two kinds:
//  - platform_baseline : shared, open-licensed curriculum content (ACARA, NSW
//    NESA, Illustrative Maths, ...). NOT tied to any tenant (tenant_id IS NULL).
//    Embedded ONCE by the platform and reused by every tenant. Readable by all
//    authenticated users; written only via the service-role key.
//  - tenant_uploaded   : a tenant's own materials (Fatima's Fractions PDF, ...).
//    Standard tenant_id isolation. tenant_id IS NOT NULL.
// See 17_Baseline_Curriculum_Corpus.md. The `documents` table (Day 4, pgvector)
// will carry a corpus_source_id FK back to here.
export const corpusKindEnum = pgEnum("corpus_kind", [
  "platform_baseline",
  "tenant_uploaded",
]);

export const corpusSources = pgTable(
  "corpus_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: corpusKindEnum("kind").notNull(),
    name: text("name").notNull(), // "Illustrative Mathematics Yr 7"
    region: text("region"), // "AU-NSW", "US-K12", "Global"
    syllabus: text("syllabus"), // "NSW NESA Maths", "Common Core 7"
    license: text("license"), // "CC-BY-4.0"
    url: text("url"), // source URL
    // NULL for platform_baseline; set for tenant_uploaded. Enforced by the
    // check constraint below so the two kinds can never be mixed up.
    tenantId: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("corpus_sources_tenant_idx").on(t.tenantId),
    index("corpus_sources_kind_idx").on(t.kind),
    check(
      "corpus_sources_kind_tenant_ck",
      sql`(${t.kind} = 'platform_baseline' AND ${t.tenantId} IS NULL) OR (${t.kind} = 'tenant_uploaded' AND ${t.tenantId} IS NOT NULL)`,
    ),
  ],
);

// ---------- tenant_corpus_subscriptions ----------
// Which platform_baseline corpora a tenant has enabled. Tenant-uploaded sources
// are always available to their tenant; baseline ones require an explicit
// subscription row here. RAG retrieval = (baseline docs WHERE corpus IN this
// tenant's subscriptions) UNION (tenant_uploaded docs WHERE tenant_id = current).
export const tenantCorpusSubscriptions = pgTable(
  "tenant_corpus_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    corpusSourceId: uuid("corpus_source_id")
      .notNull()
      .references(() => corpusSources.id, { onDelete: "cascade" }),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique("tenant_corpus_sub_unique").on(t.tenantId, t.corpusSourceId),
    index("tenant_corpus_sub_tenant_idx").on(t.tenantId),
  ],
);

// ---------- lessons ----------
// One row = one attended block against an ENROLLMENT on one date. Doubles as
// BOTH the attendance register AND the billing ledger line (attendance IS
// billing — her #1 pain). amount_cents is the fee posted for this lesson,
// snapshotted at mark time as round(duration_minutes / 60 × enrollment rate):
//   present  -> hours × rate, late -> hours × rate (configurable later),
//   absent   -> 0,            cancelled -> 0 (tutor-cancelled, no charge).
// A student's invoice for a cycle = sum(amount_cents) across ALL their
// enrollments' lessons in that cycle. Multiple lessons per student per day are
// allowed (different enrollments, or a double session); the one-per-enrollment-
// per-day convention is enforced in app code, not the DB (doc 27 §2.3).
export const lessonStatusEnum = pgEnum("lesson_status", [
  "present",
  "absent",
  "late",
  "cancelled",
]);

export const lessons = pgTable(
  "lessons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    // The enrollment this block belongs to (rate + subject resolve via it).
    // Nullable only to survive a legacy/bare one-off; normal marks always set it.
    enrollmentId: uuid("enrollment_id").references(() => enrollments.id, {
      onDelete: "cascade",
    }),
    date: date("date").notNull(), // 'YYYY-MM-DD' (the lesson day)
    status: lessonStatusEnum("status").notNull(),
    // The block billed, in minutes. Defaults from the enrollment's
    // session_minutes; overridable for a long / double class.
    durationMinutes: integer("duration_minutes").default(0).notNull(),
    amountCents: integer("amount_cents").default(0).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // No unique(student_id, date): a student may have several lessons a day
    // (different enrollments or a double session). One-per-enrollment-per-day is
    // a code convention (doc 27 §2.3); firm occurrence identity arrives in B.
    index("lessons_tenant_idx").on(t.tenantId),
    index("lessons_student_idx").on(t.studentId),
    index("lessons_enrollment_idx").on(t.enrollmentId),
    index("lessons_date_idx").on(t.date),
  ],
);

// ---------- payments ----------
// Money actually RECEIVED against a student's fees (cash, card, PayID, etc.).
// Separate from lessons (which are what's BILLED). Outstanding = billed − paid.
// Not tied to a specific lesson — a parent might pay a month in one cash drop.
export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "card",
  "payid",
  "transfer",
  "other",
]);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    method: paymentMethodEnum("method").notNull(),
    paidOn: date("paid_on").notNull(), // 'YYYY-MM-DD'
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("payments_tenant_idx").on(t.tenantId),
    index("payments_student_idx").on(t.studentId),
    index("payments_paid_on_idx").on(t.paidOn),
  ],
);

// ---------- reports (parent heartbeat) ----------
// One persisted weekly progress note per student per billing-agnostic weekly
// period. Lifecycle: draft (AI-written, tutor-only) -> approved (tutor signed
// off) -> sent (delivered to parent). A parent may ONLY ever see approved/sent
// rows (enforced in RLS, not just the UI). The voice output is split into
// greeting/body/signoff so "Copy note" and email render identically; `stats` is
// the snapshot of facts the note was written from (audit + anti-fabrication).
// See 20_Product_UX_and_Moat.md §7.
export const reportStatusEnum = pgEnum("report_status", [
  "draft",
  "approved",
  "sent",
]);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    // Inclusive weekly window the note covers (YYYY-MM-DD).
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: reportStatusEnum("status").default("draft").notNull(),
    // Voice output (the soul). body is required; greeting/signoff optional.
    greeting: text("greeting"),
    body: text("body").notNull(),
    signoff: text("signoff"),
    model: text("model"), // which model wrote it (transparency)
    // Snapshot of the computed facts (WeeklyStats) the note was grounded in.
    stats: jsonb("stats"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    // One note per student per weekly period — re-drafting is an idempotent
    // upsert that must never clobber an already-approved note (enforced in code).
    unique("reports_student_period_unique").on(t.studentId, t.periodStart),
    index("reports_tenant_idx").on(t.tenantId),
    index("reports_student_idx").on(t.studentId),
    index("reports_status_idx").on(t.status),
  ],
);

// ---------- worksheets (tenant library — Slice C) ----------
// A reusable, tenant-scoped file Fatima uploads ONCE and assigns REPEATEDLY
// across students and years (doc 26 §2C). Tagged by subject + year (+ optional
// topic/order) so she can find the next one. DISTINCT from the RAG baseline
// corpus (corpus_sources / doc 17): that is the model's knowledge; this is her
// assignable files. The bytes live in the private `worksheets` storage bucket;
// `storage_path` is the object key (`${tenantId}/${worksheetId}/${file}`).
export const worksheets = pgTable(
  "worksheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // Tags. subject is a soft FK (set null on subject delete); year/topic/order
    // are free-form so the library isn't rigid.
    subjectId: uuid("subject_id").references(() => subjects.id, {
      onDelete: "set null",
    }),
    yearLevel: text("year_level"), // "Y6"
    topic: text("topic"), // "Fractions → decimals"
    orderIndex: integer("order_index"), // optional sequence within a topic
    storagePath: text("storage_path").notNull(), // object key in `worksheets` bucket
    fileName: text("file_name").notNull(),
    fileMime: text("file_mime").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("worksheets_tenant_idx").on(t.tenantId),
    index("worksheets_subject_idx").on(t.subjectId),
  ],
);

// ---------- assignments (per-student pipeline — Slice C) ----------
// One row = one worksheet placed in a student's queue (or an ad-hoc "do this"
// with no library file). Curation is per-student and ad-hoc (doc 26 §2C) — no
// shared curriculum. `order_index` drives the "up next" pointer (lowest index
// among not-yet-returned). worksheet_id is OPTIONAL so a bare "bring your book"
// assignment works; submission (below) can also stand alone with no assignment.
export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    // Optional context — which enrollment/subject this belongs to (for filtering
    // + the future diligence→report join). Nullable so a quick assignment needs
    // no enrollment.
    enrollmentId: uuid("enrollment_id").references(() => enrollments.id, {
      onDelete: "set null",
    }),
    subjectId: uuid("subject_id").references(() => subjects.id, {
      onDelete: "set null",
    }),
    worksheetId: uuid("worksheet_id").references(() => worksheets.id, {
      onDelete: "set null",
    }),
    // Denormalised label so the pipeline reads even if the worksheet is archived
    // or the assignment is ad-hoc (no worksheet).
    title: text("title").notNull(),
    status: assignmentStatusEnum("status").default("assigned").notNull(),
    dueDate: date("due_date"), // 'YYYY-MM-DD'; null = no hard due date
    // Per-student queue ordering. Lower = sooner; the lowest not-returned row is
    // "up next". Defaults high so new rows land at the back until reordered.
    orderIndex: integer("order_index").default(1000).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("assignments_tenant_idx").on(t.tenantId),
    index("assignments_student_idx").on(t.studentId),
    index("assignments_status_idx").on(t.status),
  ],
);

// ---------- submissions (the unit of record — Slice C) ----------
// 1..n image pages or a PDF of a student's work. May attach to an assignment OR
// STAND ALONE (snap a notebook page, correct on the spot — never force
// assignment-first, doc 26 §2C). `uploader_role` is polymorphic (pilot = tutor).
// Files live in the private `submissions` bucket; `pages` holds their object
// keys + display metadata.
export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    // Optional link to an assignment; null = standalone (notebook-photo path).
    assignmentId: uuid("assignment_id").references(() => assignments.id, {
      onDelete: "set null",
    }),
    // Denormalised subject for standalone submissions (no assignment behind them).
    subjectId: uuid("subject_id").references(() => subjects.id, {
      onDelete: "set null",
    }),
    uploaderRole: uploaderRoleEnum("uploader_role")
      .$type<UploaderRole>()
      .default("tutor")
      .notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // The uploaded pages (object keys in the `submissions` bucket + metadata).
    pages: jsonb("pages").$type<SubmissionPage[]>().default([]).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("submissions_tenant_idx").on(t.tenantId),
    index("submissions_student_idx").on(t.studentId),
    index("submissions_assignment_idx").on(t.assignmentId),
  ],
);

// ---------- corrections (AI draft -> tutor release — Slice C) ----------
// One correction per submission. AI DRAFTS per-item verdicts + a voiced note in
// the tutor's voice; the tutor reviews/edits every item and RELEASES. No
// trusted-auto-release (doc 26 §2C). `stats` is the tally snapshot the report/
// diligence reads (frozen at release). Red-pen-on-image is deferred.
export const corrections = pgTable(
  "corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    status: correctionStatusEnum("status").default("draft").notNull(),
    // Per-question verdicts (right/wrong/partial + comment). Editable pre-release.
    items: jsonb("items").$type<CorrectionItem[]>().default([]).notNull(),
    // The short feedback note in the tutor's voice, referencing the work.
    voicedNote: text("voiced_note"),
    // Tally snapshot ({total,right,wrong,partial}) for the report — frozen at
    // release so a later edit is captured deterministically.
    stats: jsonb("stats").$type<CorrectionStats>(),
    model: text("model"), // which model drafted it (transparency)
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // One correction per submission — re-drafting overwrites the draft, never
    // stacks. (A released correction is edited in place, then re-released.)
    unique("corrections_submission_unique").on(t.submissionId),
    index("corrections_tenant_idx").on(t.tenantId),
    index("corrections_student_idx").on(t.studentId),
    index("corrections_status_idx").on(t.status),
  ],
);

// ---------- relations ----------
// Drizzle relations API for ergonomic joins from query builder.

export const tenantsRelations = relations(tenants, ({ many }) => ({
  memberships: many(memberships),
  students: many(students),
  subjects: many(subjects),
  priceListItems: many(priceListItems),
  enrollments: many(enrollments),
  corpusSources: many(corpusSources),
  corpusSubscriptions: many(tenantCorpusSubscriptions),
  lessons: many(lessons),
  payments: many(payments),
  reports: many(reports),
  worksheets: many(worksheets),
  assignments: many(assignments),
  submissions: many(submissions),
  corrections: many(corrections),
}));

export const worksheetsRelations = relations(worksheets, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [worksheets.tenantId],
    references: [tenants.id],
  }),
  subject: one(subjects, {
    fields: [worksheets.subjectId],
    references: [subjects.id],
  }),
  assignments: many(assignments),
}));

export const assignmentsRelations = relations(assignments, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [assignments.tenantId],
    references: [tenants.id],
  }),
  student: one(students, {
    fields: [assignments.studentId],
    references: [students.id],
  }),
  enrollment: one(enrollments, {
    fields: [assignments.enrollmentId],
    references: [enrollments.id],
  }),
  subject: one(subjects, {
    fields: [assignments.subjectId],
    references: [subjects.id],
  }),
  worksheet: one(worksheets, {
    fields: [assignments.worksheetId],
    references: [worksheets.id],
  }),
  submissions: many(submissions),
}));

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [submissions.tenantId],
    references: [tenants.id],
  }),
  student: one(students, {
    fields: [submissions.studentId],
    references: [students.id],
  }),
  assignment: one(assignments, {
    fields: [submissions.assignmentId],
    references: [assignments.id],
  }),
  subject: one(subjects, {
    fields: [submissions.subjectId],
    references: [subjects.id],
  }),
  uploader: one(users, {
    fields: [submissions.uploadedBy],
    references: [users.id],
  }),
  corrections: many(corrections),
}));

export const correctionsRelations = relations(corrections, ({ one }) => ({
  tenant: one(tenants, {
    fields: [corrections.tenantId],
    references: [tenants.id],
  }),
  submission: one(submissions, {
    fields: [corrections.submissionId],
    references: [submissions.id],
  }),
  student: one(students, {
    fields: [corrections.studentId],
    references: [students.id],
  }),
}));

export const subjectsRelations = relations(subjects, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [subjects.tenantId],
    references: [tenants.id],
  }),
  priceListItems: many(priceListItems),
  enrollments: many(enrollments),
}));

export const priceListItemsRelations = relations(
  priceListItems,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [priceListItems.tenantId],
      references: [tenants.id],
    }),
    subject: one(subjects, {
      fields: [priceListItems.subjectId],
      references: [subjects.id],
    }),
    enrollments: many(enrollments),
  }),
);

export const enrollmentsRelations = relations(enrollments, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [enrollments.tenantId],
    references: [tenants.id],
  }),
  student: one(students, {
    fields: [enrollments.studentId],
    references: [students.id],
  }),
  subject: one(subjects, {
    fields: [enrollments.subjectId],
    references: [subjects.id],
  }),
  priceListItem: one(priceListItems, {
    fields: [enrollments.priceListItemId],
    references: [priceListItems.id],
  }),
  lessons: many(lessons),
}));

export const corpusSourcesRelations = relations(
  corpusSources,
  ({ one, many }) => ({
    // optional: NULL for platform_baseline
    tenant: one(tenants, {
      fields: [corpusSources.tenantId],
      references: [tenants.id],
    }),
    subscriptions: many(tenantCorpusSubscriptions),
  }),
);

export const tenantCorpusSubscriptionsRelations = relations(
  tenantCorpusSubscriptions,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [tenantCorpusSubscriptions.tenantId],
      references: [tenants.id],
    }),
    corpusSource: one(corpusSources, {
      fields: [tenantCorpusSubscriptions.corpusSourceId],
      references: [corpusSources.id],
    }),
  }),
);

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  parentLinks: many(studentParents),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  tenant: one(tenants, {
    fields: [memberships.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
  }),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [students.tenantId],
    references: [tenants.id],
  }),
  parentLinks: many(studentParents),
  enrollments: many(enrollments),
  lessons: many(lessons),
  payments: many(payments),
  reports: many(reports),
  assignments: many(assignments),
  submissions: many(submissions),
  corrections: many(corrections),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  tenant: one(tenants, {
    fields: [payments.tenantId],
    references: [tenants.id],
  }),
  student: one(students, {
    fields: [payments.studentId],
    references: [students.id],
  }),
}));

export const lessonsRelations = relations(lessons, ({ one }) => ({
  tenant: one(tenants, {
    fields: [lessons.tenantId],
    references: [tenants.id],
  }),
  student: one(students, {
    fields: [lessons.studentId],
    references: [students.id],
  }),
  enrollment: one(enrollments, {
    fields: [lessons.enrollmentId],
    references: [enrollments.id],
  }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  tenant: one(tenants, {
    fields: [reports.tenantId],
    references: [tenants.id],
  }),
  student: one(students, {
    fields: [reports.studentId],
    references: [students.id],
  }),
  approver: one(users, {
    fields: [reports.approvedBy],
    references: [users.id],
  }),
}));

export const studentParentsRelations = relations(studentParents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [studentParents.tenantId],
    references: [tenants.id],
  }),
  student: one(students, {
    fields: [studentParents.studentId],
    references: [students.id],
  }),
  parent: one(users, {
    fields: [studentParents.parentUserId],
    references: [users.id],
  }),
}));

// ---------- type exports ----------
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
export type Student = typeof students.$inferSelect;
export type NewStudent = typeof students.$inferInsert;
export type StudentParent = typeof studentParents.$inferSelect;
export type NewStudentParent = typeof studentParents.$inferInsert;
export type Subject = typeof subjects.$inferSelect;
export type NewSubject = typeof subjects.$inferInsert;
export type PriceListItem = typeof priceListItems.$inferSelect;
export type NewPriceListItem = typeof priceListItems.$inferInsert;
export type Enrollment = typeof enrollments.$inferSelect;
export type NewEnrollment = typeof enrollments.$inferInsert;
export type EnrollmentMode = (typeof enrollmentModeEnum.enumValues)[number];
export type CorpusSource = typeof corpusSources.$inferSelect;
export type NewCorpusSource = typeof corpusSources.$inferInsert;
export type TenantCorpusSubscription =
  typeof tenantCorpusSubscriptions.$inferSelect;
export type NewTenantCorpusSubscription =
  typeof tenantCorpusSubscriptions.$inferInsert;
export type Lesson = typeof lessons.$inferSelect;
export type NewLesson = typeof lessons.$inferInsert;
export type LessonStatus = (typeof lessonStatusEnum.enumValues)[number];
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
export type BillingCycle = (typeof billingCycleEnum.enumValues)[number];
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type ReportStatus = (typeof reportStatusEnum.enumValues)[number];
export type Worksheet = typeof worksheets.$inferSelect;
export type NewWorksheet = typeof worksheets.$inferInsert;
export type Assignment = typeof assignments.$inferSelect;
export type NewAssignment = typeof assignments.$inferInsert;
export type AssignmentStatus = (typeof assignmentStatusEnum.enumValues)[number];
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type Correction = typeof corrections.$inferSelect;
export type NewCorrection = typeof corrections.$inferInsert;
export type CorrectionStatus = (typeof correctionStatusEnum.enumValues)[number];
