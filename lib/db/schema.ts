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
    yearLevel: text("year_level"), // 'Y3', 'Y4', etc.
    active: boolean("active").default(true).notNull(),
    // Default fee charged per attended lesson (attendance-driven billing).
    // Nullable until a rate is assigned. onDelete set null so deleting a rate
    // card doesn't cascade-delete students.
    defaultRateCardId: uuid("default_rate_card_id").references(
      () => rateCards.id,
      { onDelete: "set null" },
    ),
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

// ---------- rate_cards ----------
// A named fee (per attended lesson). Per-student rate lives on
// students.default_rate_card_id. Reusable so the same fee can apply to many
// students and so the SaaS can offer tiered rates later. Amount in cents to
// avoid float money bugs.
export const rateCards = pgTable(
  "rate_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // "Standard 1:1", "Sibling rate"
    amountCents: integer("amount_cents").notNull(), // e.g. 8000 = AUD 80.00
    currency: text("currency").default("AUD").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("rate_cards_tenant_idx").on(t.tenantId)],
);

// ---------- lessons ----------
// One row = one student's session on one date. Doubles as BOTH the attendance
// register AND the billing ledger line (attendance IS billing — her #1 pain).
// amount_cents is the fee posted for this lesson, snapshotted at mark time:
//   present  -> full rate, late -> full rate (configurable later),
//   absent   -> 0,        cancelled -> 0 (tutor-cancelled, no charge).
// Monthly statement = sum(amount_cents) per student per month.
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
    date: date("date").notNull(), // 'YYYY-MM-DD' (the lesson day)
    status: lessonStatusEnum("status").notNull(),
    amountCents: integer("amount_cents").default(0).notNull(),
    // Which rate produced amount_cents (snapshot; nullable so history survives
    // a rate-card delete).
    rateCardId: uuid("rate_card_id").references(() => rateCards.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // One lesson per student per day (demo assumption; lets marking be an
    // idempotent upsert).
    unique("lessons_student_date_unique").on(t.studentId, t.date),
    index("lessons_tenant_idx").on(t.tenantId),
    index("lessons_student_idx").on(t.studentId),
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

// ---------- relations ----------
// Drizzle relations API for ergonomic joins from query builder.

export const tenantsRelations = relations(tenants, ({ many }) => ({
  memberships: many(memberships),
  students: many(students),
  corpusSources: many(corpusSources),
  corpusSubscriptions: many(tenantCorpusSubscriptions),
  rateCards: many(rateCards),
  lessons: many(lessons),
  payments: many(payments),
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
  lessons: many(lessons),
  payments: many(payments),
  defaultRateCard: one(rateCards, {
    fields: [students.defaultRateCardId],
    references: [rateCards.id],
  }),
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

export const rateCardsRelations = relations(rateCards, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [rateCards.tenantId],
    references: [tenants.id],
  }),
  students: many(students),
  lessons: many(lessons),
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
  rateCard: one(rateCards, {
    fields: [lessons.rateCardId],
    references: [rateCards.id],
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
export type CorpusSource = typeof corpusSources.$inferSelect;
export type NewCorpusSource = typeof corpusSources.$inferInsert;
export type TenantCorpusSubscription =
  typeof tenantCorpusSubscriptions.$inferSelect;
export type NewTenantCorpusSubscription =
  typeof tenantCorpusSubscriptions.$inferInsert;
export type RateCard = typeof rateCards.$inferSelect;
export type NewRateCard = typeof rateCards.$inferInsert;
export type Lesson = typeof lessons.$inferSelect;
export type NewLesson = typeof lessons.$inferInsert;
export type LessonStatus = (typeof lessonStatusEnum.enumValues)[number];
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
export type BillingCycle = (typeof billingCycleEnum.enumValues)[number];
