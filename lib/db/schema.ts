import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  pgEnum,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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

// ---------- tenants ----------
// One tenant per tutoring practice. Fatima is tenant #1.
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  brandColor: text("brand_color").default("#3D2C4F").notNull(),
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

// ---------- relations ----------
// Drizzle relations API for ergonomic joins from query builder.

export const tenantsRelations = relations(tenants, ({ many }) => ({
  memberships: many(memberships),
  students: many(students),
}));

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
