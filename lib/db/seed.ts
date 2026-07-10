/**
 * Seed Fatima's pilot tenant onto the Slice A schema (subjects → price catalog →
 * enrollments → hours×rate lessons).
 *
 *   pnpm db:seed
 *
 * Idempotent — fixed UUIDs + upserts, safe to re-run. Creates:
 *   - 1 tenant (ImpactStudy, Fatima's brand)
 *   - 1 owner (Fatima) + 2 parents, as real Supabase Auth users
 *   - 4 subjects (English, Physics, Chemistry, Maths)
 *   - 6 price-list rows (year × subject × mode → hourly rate + session length)
 *   - 4 students w/ year levels, 3 parent→student links (1 unparented)
 *   - 6 enrollments (incl. a group + multi-enrollment student)
 *   - ~5 weeks of twice-weekly lessons billed hours × rate
 *   - 3 platform_baseline corpus sources + 1 tenant_uploaded + 3 subscriptions
 *
 * TEST IDENTITIES use Gmail plus-addressing off ONE inbox (SEED_BASE_EMAIL) so
 * you can magic-link in as every role from your own inbox and verify RLS.
 *
 * Writes go via the SERVICE-ROLE key + Drizzle (both bypass RLS).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import { createClient, type User } from "@supabase/supabase-js";
import * as schema from "./schema";
import { FATIMA_VOICE } from "../voice-types";

// ---------- env ----------
const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
const BASE_EMAIL = process.env.SEED_BASE_EMAIL ?? "samuqsith@gmail.com";

if (!DATABASE_URL || !SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "❌ Missing env. Need DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY in .env.local",
  );
  process.exit(1);
}

// Gmail plus-addressing: "a@b.com" + "fatima" -> "a+fatima@b.com"
function plus(label: string): string {
  const [local, domain] = BASE_EMAIL.split("@");
  return `${local}+${label}@${domain}`;
}

/** round(minutes/60 × hourly_rate_cents) — mirrors lib/billing blockAmountCents. */
function blockCents(minutes: number, hourlyRateCents: number): number {
  return Math.round((minutes / 60) * hourlyRateCents);
}

// ---------- fixed UUIDs (deterministic → idempotent) ----------
const TENANT_ID = "a0000000-0000-4000-8000-000000000001";
const ST = {
  amara: "a0000000-0000-4000-8000-000000000011",
  bilal: "a0000000-0000-4000-8000-000000000012",
  chloe: "a0000000-0000-4000-8000-000000000013",
  dev: "a0000000-0000-4000-8000-000000000014",
};
const CORP = {
  acara: "a0000000-0000-4000-8000-000000000021",
  nesa: "a0000000-0000-4000-8000-000000000022",
  im: "a0000000-0000-4000-8000-000000000023",
  fatimaPdf: "a0000000-0000-4000-8000-000000000024",
};
const SUBJ = {
  english: "a0000000-0000-4000-8000-000000000041",
  physics: "a0000000-0000-4000-8000-000000000042",
  chemistry: "a0000000-0000-4000-8000-000000000043",
  maths: "a0000000-0000-4000-8000-000000000044",
};
const PRICE = {
  y6PhysicsOneToOne: "a0000000-0000-4000-8000-000000000051", // $60/hr, 60 min
  y6MathsGroup: "a0000000-0000-4000-8000-000000000052", // $40/hr, 90 min
  y7MathsOneToOne: "a0000000-0000-4000-8000-000000000053", // $65/hr, 60 min
  y5EnglishGroup: "a0000000-0000-4000-8000-000000000054", // $40/hr, 90 min
  y8ChemistryOneToOne: "a0000000-0000-4000-8000-000000000055", // $75/hr, 60 min
  y8MathsOneToOne: "a0000000-0000-4000-8000-000000000056", // $75/hr, 60 min
};
const ENR = {
  amaraPhysics: "a0000000-0000-4000-8000-000000000061",
  amaraMathsGroup: "a0000000-0000-4000-8000-000000000062",
  bilalMaths: "a0000000-0000-4000-8000-000000000063",
  chloeEnglish: "a0000000-0000-4000-8000-000000000064",
  devChemistry: "a0000000-0000-4000-8000-000000000065",
  devMaths: "a0000000-0000-4000-8000-000000000066",
};

// ---------- clients ----------
const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });
const db = drizzle(sql, { schema });
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------- helpers ----------
async function getOrCreateAuthUser(
  email: string,
  displayName: string,
): Promise<User> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (data?.user) return data.user;

  if (error && /registered|exists/i.test(error.message)) {
    for (let page = 1; ; page++) {
      const { data: list, error: listErr } =
        await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (listErr) throw listErr;
      const found = list.users.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase(),
      );
      if (found) return found;
      if (list.users.length < 200) break;
    }
  }
  throw error ?? new Error(`Could not create or find auth user ${email}`);
}

async function upsertUserRow(u: User, displayName: string) {
  await db
    .insert(schema.users)
    .values({ id: u.id, email: u.email!, displayName })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: { email: u.email!, displayName },
    });
}

// ---------- main ----------
async function main() {
  console.log(`Seeding with base inbox: ${BASE_EMAIL}`);

  // 1. Auth users (owner + 2 parents)
  const ownerEmail = process.env.FATIMA_OWNER_EMAIL?.trim() || plus("fatima");
  const parent1Email = plus("parent1");
  const parent2Email = plus("parent2");

  const owner = await getOrCreateAuthUser(ownerEmail, "Fatima (ImpactStudy)");
  const parent1 = await getOrCreateAuthUser(parent1Email, "Parent One");
  const parent2 = await getOrCreateAuthUser(parent2Email, "Parent Two");

  await upsertUserRow(owner, "Fatima (ImpactStudy)");
  await upsertUserRow(parent1, "Parent One");
  await upsertUserRow(parent2, "Parent Two");

  // 2. Tenant
  await db
    .insert(schema.tenants)
    .values({
      id: TENANT_ID,
      slug: "impactstudy",
      displayName: "ImpactStudy",
      brandColor: "#3D2C4F",
      voiceSignature: FATIMA_VOICE,
    })
    .onConflictDoUpdate({
      target: schema.tenants.id,
      set: {
        slug: "impactstudy",
        displayName: "ImpactStudy",
        voiceSignature: FATIMA_VOICE,
      },
    });

  // 3. Memberships (owner = staff; parents = parent role)
  await db
    .insert(schema.memberships)
    .values([
      { tenantId: TENANT_ID, userId: owner.id, role: "owner" },
      { tenantId: TENANT_ID, userId: parent1.id, role: "parent" },
      { tenantId: TENANT_ID, userId: parent2.id, role: "parent" },
    ])
    .onConflictDoNothing();

  // 4. Subjects
  await db
    .insert(schema.subjects)
    .values([
      { id: SUBJ.english, tenantId: TENANT_ID, name: "English" },
      { id: SUBJ.physics, tenantId: TENANT_ID, name: "Physics" },
      { id: SUBJ.chemistry, tenantId: TENANT_ID, name: "Chemistry" },
      { id: SUBJ.maths, tenantId: TENANT_ID, name: "Maths" },
    ])
    .onConflictDoUpdate({
      target: schema.subjects.id,
      set: { name: schema.subjects.name, active: true },
    });

  // 5. Price list (year × subject × mode → hourly rate + session length)
  await db
    .insert(schema.priceListItems)
    .values([
      { id: PRICE.y6PhysicsOneToOne, tenantId: TENANT_ID, yearLevel: "Y6", subjectId: SUBJ.physics, mode: "one_to_one", hourlyRateCents: 6000, defaultSessionMinutes: 60 },
      { id: PRICE.y6MathsGroup, tenantId: TENANT_ID, yearLevel: "Y6", subjectId: SUBJ.maths, mode: "group", hourlyRateCents: 4000, defaultSessionMinutes: 90 },
      { id: PRICE.y7MathsOneToOne, tenantId: TENANT_ID, yearLevel: "Y7", subjectId: SUBJ.maths, mode: "one_to_one", hourlyRateCents: 6500, defaultSessionMinutes: 60 },
      { id: PRICE.y5EnglishGroup, tenantId: TENANT_ID, yearLevel: "Y5", subjectId: SUBJ.english, mode: "group", hourlyRateCents: 4000, defaultSessionMinutes: 90 },
      { id: PRICE.y8ChemistryOneToOne, tenantId: TENANT_ID, yearLevel: "Y8", subjectId: SUBJ.chemistry, mode: "one_to_one", hourlyRateCents: 7500, defaultSessionMinutes: 60 },
      { id: PRICE.y8MathsOneToOne, tenantId: TENANT_ID, yearLevel: "Y8", subjectId: SUBJ.maths, mode: "one_to_one", hourlyRateCents: 7500, defaultSessionMinutes: 60 },
    ])
    .onConflictDoUpdate({
      target: schema.priceListItems.id,
      set: {
        hourlyRateCents: schema.priceListItems.hourlyRateCents,
        defaultSessionMinutes: schema.priceListItems.defaultSessionMinutes,
        active: true,
      },
    });

  // 6. Students (4; one stays unparented to test the parent-scope boundary)
  await db
    .insert(schema.students)
    .values([
      { id: ST.amara, tenantId: TENANT_ID, firstName: "Amara", lastName: "Khan", yearLevel: "Y6" },
      { id: ST.bilal, tenantId: TENANT_ID, firstName: "Bilal", lastName: "Ahmed", yearLevel: "Y7" },
      { id: ST.chloe, tenantId: TENANT_ID, firstName: "Chloe", lastName: "Nguyen", yearLevel: "Y5" },
      { id: ST.dev, tenantId: TENANT_ID, firstName: "Dev", lastName: "Patel", yearLevel: "Y8" },
    ])
    .onConflictDoUpdate({
      target: schema.students.id,
      set: { active: true, yearLevel: schema.students.yearLevel },
    });

  // Per-student billing cycles (varied for the demo), anchored 5 weeks ago.
  const anchorDate = new Date();
  anchorDate.setUTCDate(anchorDate.getUTCDate() - 35);
  const anchorIso = anchorDate.toISOString().slice(0, 10);
  await db
    .update(schema.students)
    .set({ billingCycle: "weekly", billingAnchor: anchorIso })
    .where(inArray(schema.students.id, [ST.amara, ST.dev]));
  await db
    .update(schema.students)
    .set({ billingCycle: "fortnightly", billingAnchor: anchorIso })
    .where(eq(schema.students.id, ST.bilal));
  await db
    .update(schema.students)
    .set({ billingCycle: "monthly", billingAnchor: anchorIso })
    .where(eq(schema.students.id, ST.chloe));

  // 7. Parent → student links (parent1: Amara+Bilal; parent2: Chloe; Dev: none)
  await db
    .insert(schema.studentParents)
    .values([
      { tenantId: TENANT_ID, studentId: ST.amara, parentUserId: parent1.id, relationship: "mother", isPrimary: true },
      { tenantId: TENANT_ID, studentId: ST.bilal, parentUserId: parent1.id, relationship: "mother", isPrimary: true },
      { tenantId: TENANT_ID, studentId: ST.chloe, parentUserId: parent2.id, relationship: "father", isPrimary: true },
    ])
    .onConflictDoNothing();

  // 8. Enrollments (snapshot rate + session length from the matching price row)
  const enrollmentDefs = [
    { id: ENR.amaraPhysics, studentId: ST.amara, subjectId: SUBJ.physics, mode: "one_to_one" as const, priceId: PRICE.y6PhysicsOneToOne, rate: 6000, minutes: 60 },
    { id: ENR.amaraMathsGroup, studentId: ST.amara, subjectId: SUBJ.maths, mode: "group" as const, priceId: PRICE.y6MathsGroup, rate: 4000, minutes: 90 },
    { id: ENR.bilalMaths, studentId: ST.bilal, subjectId: SUBJ.maths, mode: "one_to_one" as const, priceId: PRICE.y7MathsOneToOne, rate: 6500, minutes: 60 },
    { id: ENR.chloeEnglish, studentId: ST.chloe, subjectId: SUBJ.english, mode: "group" as const, priceId: PRICE.y5EnglishGroup, rate: 4000, minutes: 90 },
    { id: ENR.devChemistry, studentId: ST.dev, subjectId: SUBJ.chemistry, mode: "one_to_one" as const, priceId: PRICE.y8ChemistryOneToOne, rate: 7500, minutes: 60 },
    { id: ENR.devMaths, studentId: ST.dev, subjectId: SUBJ.maths, mode: "one_to_one" as const, priceId: PRICE.y8MathsOneToOne, rate: 7500, minutes: 60 },
  ];
  await db
    .insert(schema.enrollments)
    .values(
      enrollmentDefs.map((e) => ({
        id: e.id,
        tenantId: TENANT_ID,
        studentId: e.studentId,
        subjectId: e.subjectId,
        mode: e.mode,
        priceListItemId: e.priceId,
        hourlyRateCents: e.rate,
        currency: "AUD",
        sessionMinutes: e.minutes,
        startDate: anchorIso,
      })),
    )
    .onConflictDoUpdate({
      target: schema.enrollments.id,
      set: {
        active: true,
        hourlyRateCents: schema.enrollments.hourlyRateCents,
        sessionMinutes: schema.enrollments.sessionMinutes,
      },
    });

  // 9. Corpus sources — 3 platform_baseline (NULL tenant) + 1 tenant_uploaded
  await db
    .insert(schema.corpusSources)
    .values([
      { id: CORP.acara, kind: "platform_baseline", name: "ACARA — Australian Curriculum (Maths)", region: "AU", syllabus: "ACARA Maths", license: "CC-BY-4.0", url: "https://www.australiancurriculum.edu.au", tenantId: null },
      { id: CORP.nesa, kind: "platform_baseline", name: "NSW NESA — Mathematics K-10 Syllabus", region: "AU-NSW", syllabus: "NSW NESA Maths", license: "CC-BY-4.0", url: "https://educationstandards.nsw.edu.au", tenantId: null },
      { id: CORP.im, kind: "platform_baseline", name: "Illustrative Mathematics 6-8", region: "Global", syllabus: "Illustrative Maths", license: "CC-BY-4.0", url: "https://illustrativemathematics.org", tenantId: null },
      { id: CORP.fatimaPdf, kind: "tenant_uploaded", name: "Fatima — Fractions/Decimals/Percentage Conversion", region: "AU-NSW", syllabus: "ImpactStudy Ratio & Proportion", license: "tenant-original", url: null, tenantId: TENANT_ID },
    ])
    .onConflictDoUpdate({
      target: schema.corpusSources.id,
      set: { name: schema.corpusSources.name },
    });

  // 10. Subscribe Fatima's tenant to the 3 baseline sources
  await db
    .insert(schema.tenantCorpusSubscriptions)
    .values([
      { tenantId: TENANT_ID, corpusSourceId: CORP.acara },
      { tenantId: TENANT_ID, corpusSourceId: CORP.nesa },
      { tenantId: TENANT_ID, corpusSourceId: CORP.im },
    ])
    .onConflictDoNothing();

  // 11. Lessons — ~5 weeks of twice-weekly attendance PER ENROLLMENT so billing
  // has real hours×rate numbers. Deterministic status (mostly present).
  //
  // Clear this tenant's lessons FIRST. Two reasons: (1) pre-pivot lessons have no
  // enrollment_id (they'd show as "Unassigned" and inflate balances), and (2)
  // lessons no longer have a natural unique key (the unique(student_id,date) was
  // relaxed in Slice A), so onConflictDoNothing can't dedupe — without this a
  // re-seed would STACK duplicate rows every run. Idempotent by construction.
  await db.delete(schema.lessons).where(eq(schema.lessons.tenantId, TENANT_ID));

  const today = new Date();
  const lessonRows: (typeof schema.lessons.$inferInsert)[] = [];

  for (let back = 0; back <= 35; back++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - back);
    const dow = d.getUTCDay(); // 1 = Mon, 4 = Thu
    if (dow !== 1 && dow !== 4) continue;
    const iso = d.toISOString().slice(0, 10);

    enrollmentDefs.forEach((en, ei) => {
      const seed = (ei + back) % 7;
      const status: "present" | "absent" | "late" =
        seed === 3 ? "absent" : seed === 5 ? "late" : "present";
      const amount = status === "absent" ? 0 : blockCents(en.minutes, en.rate);
      lessonRows.push({
        tenantId: TENANT_ID,
        studentId: en.studentId,
        enrollmentId: en.id,
        date: iso,
        status,
        durationMinutes: en.minutes,
        amountCents: amount,
      });
    });
  }

  await db.insert(schema.lessons).values(lessonRows).onConflictDoNothing();

  console.log(`Inserted/kept ${lessonRows.length} lesson rows.`);
  console.log("\n✅ Seed complete.\n");
  console.log("Log in (magic link) to verify RLS:");
  console.log(`  OWNER  ${ownerEmail}   → all 4 students, 6 enrollments`);
  console.log(`  PARENT ${parent1Email} → Amara + Bilal only`);
  console.log(`  PARENT ${parent2Email} → Chloe only`);
  console.log("\nMath check: Amara Maths group 90min @ $40/hr = $60/session.\n");
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:\n", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
