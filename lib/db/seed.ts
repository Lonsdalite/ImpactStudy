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
import { tallyItems, type CorrectionItem, type SubmissionPage } from "../homework-types";
import { sydneyWallToUtc } from "../calendar";

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
  y5MathsGroup: "a0000000-0000-4000-8000-000000000057", // $40/hr, 90 min (cluster demo)
};
const ENR = {
  amaraPhysics: "a0000000-0000-4000-8000-000000000061",
  amaraMathsGroup: "a0000000-0000-4000-8000-000000000062",
  bilalMaths: "a0000000-0000-4000-8000-000000000063",
  chloeEnglish: "a0000000-0000-4000-8000-000000000064",
  devChemistry: "a0000000-0000-4000-8000-000000000065",
  devMaths: "a0000000-0000-4000-8000-000000000066",
  chloeMathsGroup: "a0000000-0000-4000-8000-000000000067", // shares Amara's group slot
};
// Slice B — weekly schedule slots (0=Sun..6=Sat). Mon=1 Tue=2 Wed=3 Thu=4 Fri=5.
const ESCH = {
  amaraPhysicsMon: "a0000000-0000-4000-8000-0000000000b1",
  amaraPhysicsThu: "a0000000-0000-4000-8000-0000000000b2",
  amaraMathsWed: "a0000000-0000-4000-8000-0000000000b3",
  bilalMathsTue: "a0000000-0000-4000-8000-0000000000b4",
  bilalMathsFri: "a0000000-0000-4000-8000-0000000000b5",
  chloeEnglishWed: "a0000000-0000-4000-8000-0000000000b6",
  chloeMathsWed: "a0000000-0000-4000-8000-0000000000b7",
  devChemMon: "a0000000-0000-4000-8000-0000000000b8",
  devChemThu: "a0000000-0000-4000-8000-0000000000b9",
  devMathsTue: "a0000000-0000-4000-8000-0000000000ba",
  devMathsFri: "a0000000-0000-4000-8000-0000000000bb",
};
// Slice C — homework/AI-correction dummy data.
const WS = {
  fractions: "a0000000-0000-4000-8000-000000000071",
  balancing: "a0000000-0000-4000-8000-000000000072",
  comprehension: "a0000000-0000-4000-8000-000000000073",
};
const AS = {
  amaraFractions: "a0000000-0000-4000-8000-000000000081", // assigned
  bilalPages: "a0000000-0000-4000-8000-000000000082", // submitted (awaiting correction)
  devBalancing: "a0000000-0000-4000-8000-000000000083", // corrected (draft)
  chloeComprehension: "a0000000-0000-4000-8000-000000000084", // returned (released)
};
const SUB = {
  bilal: "a0000000-0000-4000-8000-000000000091",
  dev: "a0000000-0000-4000-8000-000000000092",
  chloe: "a0000000-0000-4000-8000-000000000093",
};
const CORR = {
  dev: "a0000000-0000-4000-8000-0000000000a1",
  chloe: "a0000000-0000-4000-8000-0000000000a2",
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
      { id: PRICE.y5MathsGroup, tenantId: TENANT_ID, yearLevel: "Y5", subjectId: SUBJ.maths, mode: "group", hourlyRateCents: 4000, defaultSessionMinutes: 90 },
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
    { id: ENR.chloeMathsGroup, studentId: ST.chloe, subjectId: SUBJ.maths, mode: "group" as const, priceId: PRICE.y5MathsGroup, rate: 4000, minutes: 90 },
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

  // 11a. Weekly schedule slots (Slice B — doc 26 §2B). Recurrence lives here; the
  // calendar renders virtual occurrences from these and persists a lesson only on
  // touch. Clear FIRST so a re-run never stacks. Two slots are deliberately shaped
  // for the demo: Amara + Chloe both do Maths GROUP on Wed 16:00 (visual-cluster),
  // and Dev's Chemistry sits Mon 16:00 which OVERLAPS Amara's Physics Mon 15:30–
  // 16:30 (a warn-not-block conflict).
  const enrById = new Map(enrollmentDefs.map((e) => [e.id, e]));
  const scheduleDefs = [
    { id: ESCH.amaraPhysicsMon, enrollmentId: ENR.amaraPhysics, weekday: 1, startTime: "15:30" },
    { id: ESCH.amaraPhysicsThu, enrollmentId: ENR.amaraPhysics, weekday: 4, startTime: "15:30" },
    { id: ESCH.amaraMathsWed, enrollmentId: ENR.amaraMathsGroup, weekday: 3, startTime: "16:00" },
    { id: ESCH.bilalMathsTue, enrollmentId: ENR.bilalMaths, weekday: 2, startTime: "17:00" },
    { id: ESCH.bilalMathsFri, enrollmentId: ENR.bilalMaths, weekday: 5, startTime: "17:00" },
    { id: ESCH.chloeEnglishWed, enrollmentId: ENR.chloeEnglish, weekday: 3, startTime: "09:30" },
    { id: ESCH.chloeMathsWed, enrollmentId: ENR.chloeMathsGroup, weekday: 3, startTime: "16:00" },
    { id: ESCH.devChemMon, enrollmentId: ENR.devChemistry, weekday: 1, startTime: "16:00" },
    { id: ESCH.devChemThu, enrollmentId: ENR.devChemistry, weekday: 4, startTime: "18:00" },
    { id: ESCH.devMathsTue, enrollmentId: ENR.devMaths, weekday: 2, startTime: "18:00" },
    { id: ESCH.devMathsFri, enrollmentId: ENR.devMaths, weekday: 5, startTime: "18:00" },
  ];
  await db
    .delete(schema.enrollmentSchedules)
    .where(eq(schema.enrollmentSchedules.tenantId, TENANT_ID));
  await db.insert(schema.enrollmentSchedules).values(
    scheduleDefs.map((s) => ({
      id: s.id,
      tenantId: TENANT_ID,
      enrollmentId: s.enrollmentId,
      weekday: s.weekday,
      startTime: s.startTime,
      effectiveFrom: anchorIso,
    })),
  );

  // 11b. Lessons — materialise ~5 weeks of PAST occurrences from those slots
  // (deterministic status, mostly attended) so billing + the streak have real
  // numbers. We stop at YESTERDAY: today + the rest of this week stay VIRTUAL, so
  // the calendar demo has live "mark this day / this week" work to do. Clear
  // FIRST (lessons have no natural unique key since Slice A — a re-run would
  // otherwise stack duplicates). Idempotent by construction.
  await db.delete(schema.lessons).where(eq(schema.lessons.tenantId, TENANT_ID));

  const today = new Date();
  const lessonRows: (typeof schema.lessons.$inferInsert)[] = [];

  for (let back = 1; back <= 35; back++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - back);
    const dow = d.getUTCDay(); // 0=Sun..6=Sat
    const iso = d.toISOString().slice(0, 10);
    if (iso < anchorIso) continue;

    scheduleDefs.forEach((slot, si) => {
      if (slot.weekday !== dow) return;
      const en = enrById.get(slot.enrollmentId);
      if (!en) return;
      const seed = (si + back) % 7;
      const status: "attended" | "absent" | "late" =
        seed === 3 ? "absent" : seed === 5 ? "late" : "attended";
      const amount = status === "absent" ? 0 : blockCents(en.minutes, en.rate);
      lessonRows.push({
        tenantId: TENANT_ID,
        studentId: en.studentId,
        enrollmentId: en.id,
        date: iso,
        startsAt: sydneyWallToUtc(iso, slot.startTime),
        status,
        origin: "recurring",
        durationMinutes: en.minutes,
        amountCents: amount,
      });
    });
  }

  await db.insert(schema.lessons).values(lessonRows);

  console.log(
    `Inserted ${scheduleDefs.length} schedule slots + ${lessonRows.length} past lesson rows.`,
  );

  // 12. Homework / AI correction (Slice C). Clear the tenant's C-tables FIRST
  // (FK-safe order: corrections -> submissions -> assignments -> worksheets) so
  // a re-run never stacks duplicates — same discipline as the lessons reseed.
  await db.delete(schema.corrections).where(eq(schema.corrections.tenantId, TENANT_ID));
  await db.delete(schema.submissions).where(eq(schema.submissions.tenantId, TENANT_ID));
  await db.delete(schema.assignments).where(eq(schema.assignments.tenantId, TENANT_ID));
  await db.delete(schema.worksheets).where(eq(schema.worksheets.tenantId, TENANT_ID));

  // A placeholder page so the pipeline/board render without real files (dummy
  // data — the storage object doesn't exist, so signed URLs resolve to null and
  // the UI just omits the thumbnail).
  const placeholderPages: SubmissionPage[] = [
    { path: `${TENANT_ID}/seed/placeholder.jpg`, name: "work.jpg", mime: "image/jpeg" },
  ];

  await db.insert(schema.worksheets).values([
    { id: WS.fractions, tenantId: TENANT_ID, title: "Fractions → decimals, set 3", subjectId: SUBJ.maths, yearLevel: "Y6", topic: "Ratio & proportion", storagePath: `${TENANT_ID}/seed/fractions.pdf`, fileName: "fractions-set-3.pdf", fileMime: "application/pdf" },
    { id: WS.balancing, tenantId: TENANT_ID, title: "Balancing equations intro", subjectId: SUBJ.chemistry, yearLevel: "Y8", topic: "Stoichiometry", storagePath: `${TENANT_ID}/seed/balancing.pdf`, fileName: "balancing-intro.pdf", fileMime: "application/pdf" },
    { id: WS.comprehension, tenantId: TENANT_ID, title: "Comprehension: The Lighthouse", subjectId: SUBJ.english, yearLevel: "Y5", topic: "Inference", storagePath: `${TENANT_ID}/seed/lighthouse.pdf`, fileName: "lighthouse.pdf", fileMime: "application/pdf" },
  ]);

  await db.insert(schema.assignments).values([
    { id: AS.amaraFractions, tenantId: TENANT_ID, studentId: ST.amara, enrollmentId: ENR.amaraMathsGroup, subjectId: SUBJ.maths, worksheetId: WS.fractions, title: "Fractions → decimals, set 3", status: "assigned", orderIndex: 1 },
    { id: AS.bilalPages, tenantId: TENANT_ID, studentId: ST.bilal, enrollmentId: ENR.bilalMaths, subjectId: SUBJ.maths, title: "Textbook p.42 Q1–10", status: "submitted", orderIndex: 1 },
    { id: AS.devBalancing, tenantId: TENANT_ID, studentId: ST.dev, enrollmentId: ENR.devChemistry, subjectId: SUBJ.chemistry, worksheetId: WS.balancing, title: "Balancing equations intro", status: "corrected", orderIndex: 1 },
    { id: AS.chloeComprehension, tenantId: TENANT_ID, studentId: ST.chloe, enrollmentId: ENR.chloeEnglish, subjectId: SUBJ.english, worksheetId: WS.comprehension, title: "Comprehension: The Lighthouse", status: "returned", orderIndex: 1 },
  ]);

  await db.insert(schema.submissions).values([
    { id: SUB.bilal, tenantId: TENANT_ID, studentId: ST.bilal, assignmentId: AS.bilalPages, subjectId: SUBJ.maths, uploaderRole: "tutor", pages: placeholderPages },
    { id: SUB.dev, tenantId: TENANT_ID, studentId: ST.dev, assignmentId: AS.devBalancing, subjectId: SUBJ.chemistry, uploaderRole: "tutor", pages: placeholderPages },
    { id: SUB.chloe, tenantId: TENANT_ID, studentId: ST.chloe, assignmentId: AS.chloeComprehension, subjectId: SUBJ.english, uploaderRole: "tutor", pages: placeholderPages },
  ]);

  const devItems: CorrectionItem[] = [
    { number: 1, verdict: "right", comment: "Balanced cleanly, coefficients all correct." },
    { number: 2, verdict: "partial", comment: "Right products, but recount your oxygens — they don't balance yet." },
    { number: 3, verdict: "wrong", comment: "Needs a coefficient of 2 on the left. Have another go." },
  ];
  const chloeItems: CorrectionItem[] = [
    { number: 1, verdict: "right", comment: "You picked the exact line that shows how the keeper feels." },
    { number: 2, verdict: "right", comment: "Good inference about the storm, backed with evidence." },
    { number: 3, verdict: "partial", comment: "Nearly there — just tie your answer back to the question." },
  ];

  await db.insert(schema.corrections).values([
    { id: CORR.dev, tenantId: TENANT_ID, submissionId: SUB.dev, studentId: ST.dev, status: "draft", items: devItems, voicedNote: "Hey Dev, solid effort on the balancing set. Q1 was spot on. On Q2 just recount your oxygens, and Q3 needs one more coefficient. You're really getting the hang of this.", stats: tallyItems(devItems), model: "claude-sonnet-5" },
    { id: CORR.chloe, tenantId: TENANT_ID, submissionId: SUB.chloe, studentId: ST.chloe, status: "released", items: chloeItems, voicedNote: "Hi Chloe, lovely work on The Lighthouse. Your evidence in Q1 and Q2 was exactly right. Just tie Q3 back to the question and it's perfect. I can see you're putting the effort in!", stats: tallyItems(chloeItems), model: "claude-sonnet-5", releasedAt: new Date() },
  ]);

  console.log("Seeded Slice C: 3 worksheets, 4 assignments, 3 submissions, 2 corrections.");
  console.log("\n✅ Seed complete.\n");
  console.log("Log in (magic link) to verify RLS:");
  console.log(`  OWNER  ${ownerEmail}   → all 4 students, 7 enrollments, weekly calendar`);
  console.log(`  PARENT ${parent1Email} → Amara + Bilal only`);
  console.log(`  PARENT ${parent2Email} → Chloe only`);
  console.log("\nMath check: Amara Maths group 90min @ $40/hr = $60/session.");
  console.log("Calendar demo: Wed 16:00 = Amara + Chloe Maths group (cluster);");
  console.log("               Mon = Amara Physics 15:30 vs Dev Chemistry 16:00 (conflict).\n");
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:\n", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
