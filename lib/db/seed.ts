/**
 * Seed Fatima's pilot tenant (Phase 0 Day 3).
 *
 *   pnpm db:seed
 *
 * Idempotent — fixed UUIDs + upserts, safe to re-run. Creates:
 *   - 1 tenant (ImpactStudy, Fatima's brand)
 *   - 1 owner (Fatima) + 2 parents, as real Supabase Auth users
 *   - 4 students, 3 parent→student links (1 student intentionally unparented)
 *   - 3 platform_baseline corpus sources + 1 tenant_uploaded + 3 subscriptions
 *
 * TEST IDENTITIES use Gmail plus-addressing off ONE inbox (SEED_BASE_EMAIL) so
 * you can magic-link in as every role from your own inbox and verify RLS:
 *   owner   → base+fatima@...   sees ALL students
 *   parent1 → base+parent1@...  sees ONLY their 2 children
 *   parent2 → base+parent2@...  sees ONLY their 1 child
 * Swap in Fatima's real email before the actual demo.
 *
 * Writes go via the SERVICE-ROLE key + Drizzle (both bypass RLS) — this is the
 * Phase 0 "no platform admin in schema yet" path. Does NOT import lib/db or
 * lib/env.server (their `server-only` guard throws outside the Next runtime).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import { createClient, type User } from "@supabase/supabase-js";
import * as schema from "./schema";

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
const RATE = {
  standard: "a0000000-0000-4000-8000-000000000031", // AUD 80 / lesson
  higher: "a0000000-0000-4000-8000-000000000032", // AUD 95 / lesson
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
    email_confirm: true, // pre-confirmed so magic link works immediately
    user_metadata: { display_name: displayName },
  });
  if (data?.user) return data.user;

  // Already exists → page through and match by email.
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
  // The on_auth_user_created trigger normally does this; we upsert too so the
  // seed is robust if a user predates the trigger.
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
  const ownerEmail = plus("fatima");
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
    })
    .onConflictDoUpdate({
      target: schema.tenants.id,
      set: { slug: "impactstudy", displayName: "ImpactStudy" },
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

  // 3b. Rate cards (must exist before students — students FK them)
  await db
    .insert(schema.rateCards)
    .values([
      { id: RATE.standard, tenantId: TENANT_ID, name: "Standard 1:1", amountCents: 8000 },
      { id: RATE.higher, tenantId: TENANT_ID, name: "Senior 1:1", amountCents: 9500 },
    ])
    .onConflictDoUpdate({
      target: schema.rateCards.id,
      set: { name: schema.rateCards.name, amountCents: schema.rateCards.amountCents },
    });

  // 4. Students (4; one stays unparented to test the parent-scope boundary)
  await db
    .insert(schema.students)
    .values([
      { id: ST.amara, tenantId: TENANT_ID, firstName: "Amara", lastName: "Khan", yearLevel: "Y6", defaultRateCardId: RATE.standard },
      { id: ST.bilal, tenantId: TENANT_ID, firstName: "Bilal", lastName: "Ahmed", yearLevel: "Y7", defaultRateCardId: RATE.standard },
      { id: ST.chloe, tenantId: TENANT_ID, firstName: "Chloe", lastName: "Nguyen", yearLevel: "Y5", defaultRateCardId: RATE.standard },
      { id: ST.dev, tenantId: TENANT_ID, firstName: "Dev", lastName: "Patel", yearLevel: "Y8", defaultRateCardId: RATE.higher },
    ])
    .onConflictDoUpdate({
      target: schema.students.id,
      set: { active: true },
    });

  // Ensure rates are set even for students seeded BEFORE the rate column
  // existed (onConflictDoUpdate above only refreshes `active`).
  await db
    .update(schema.students)
    .set({ defaultRateCardId: RATE.standard })
    .where(inArray(schema.students.id, [ST.amara, ST.bilal, ST.chloe]));
  await db
    .update(schema.students)
    .set({ defaultRateCardId: RATE.higher })
    .where(eq(schema.students.id, ST.dev));

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

  // 5. Parent → student links (parent1: Amara+Bilal; parent2: Chloe; Dev: none)
  await db
    .insert(schema.studentParents)
    .values([
      { tenantId: TENANT_ID, studentId: ST.amara, parentUserId: parent1.id, relationship: "mother", isPrimary: true },
      { tenantId: TENANT_ID, studentId: ST.bilal, parentUserId: parent1.id, relationship: "mother", isPrimary: true },
      { tenantId: TENANT_ID, studentId: ST.chloe, parentUserId: parent2.id, relationship: "father", isPrimary: true },
    ])
    .onConflictDoNothing();

  // 6. Corpus sources — 3 platform_baseline (NULL tenant) + 1 tenant_uploaded
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

  // 7. Subscribe Fatima's tenant to the 3 baseline sources
  await db
    .insert(schema.tenantCorpusSubscriptions)
    .values([
      { tenantId: TENANT_ID, corpusSourceId: CORP.acara },
      { tenantId: TENANT_ID, corpusSourceId: CORP.nesa },
      { tenantId: TENANT_ID, corpusSourceId: CORP.im },
    ])
    .onConflictDoNothing();

  // 8. Lessons — ~5 weeks of twice-weekly attendance so billing has real
  // numbers. Deterministic status pattern (mostly present, some absent/late).
  const rateFor: Record<string, { cents: number; card: string }> = {
    [ST.amara]: { cents: 8000, card: RATE.standard },
    [ST.bilal]: { cents: 8000, card: RATE.standard },
    [ST.chloe]: { cents: 8000, card: RATE.standard },
    [ST.dev]: { cents: 9500, card: RATE.higher },
  };
  const studentIds = [ST.amara, ST.bilal, ST.chloe, ST.dev];
  const today = new Date();
  const lessonRows: (typeof schema.lessons.$inferInsert)[] = [];

  for (let back = 0; back <= 35; back++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - back);
    const dow = d.getUTCDay(); // 1 = Mon, 4 = Thu
    if (dow !== 1 && dow !== 4) continue;
    const iso = d.toISOString().slice(0, 10);

    studentIds.forEach((sid, si) => {
      const { cents, card } = rateFor[sid];
      const seed = (si + back) % 7;
      const status: "present" | "absent" | "late" =
        seed === 3 ? "absent" : seed === 5 ? "late" : "present";
      const amountCents = status === "absent" ? 0 : cents;
      lessonRows.push({
        tenantId: TENANT_ID,
        studentId: sid,
        date: iso,
        status,
        amountCents,
        rateCardId: card,
      });
    });
  }

  await db.insert(schema.lessons).values(lessonRows).onConflictDoNothing();

  console.log(`Inserted/kept ${lessonRows.length} lesson rows.`);
  console.log("\n✅ Seed complete.\n");
  console.log("Log in (magic link) to verify RLS:");
  console.log(`  OWNER  ${ownerEmail}   → should see all 4 students`);
  console.log(`  PARENT ${parent1Email} → should see Amara + Bilal only`);
  console.log(`  PARENT ${parent2Email} → should see Chloe only`);
  console.log("All three links arrive in the one base inbox.\n");
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:\n", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
