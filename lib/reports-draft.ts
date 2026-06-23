import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { generateWeeklyReport } from "@/lib/llm/generate-report";
import { FATIMA_VOICE } from "@/lib/llm/voice";
import { reportWindow, weeklyStats, type ReportLesson } from "@/lib/reports";
import { todaySydney } from "@/lib/billing";
import type { VoiceSignature } from "@/lib/voice-types";

/**
 * The heartbeat draft engine. Summarises what a tutor logged this week into a
 * draft note per student, in the tutor's voice. ONE shared core, called two ways:
 *   - the tutor's "Draft this week's notes" button (immediate, demo path)
 *   - the weekly Inngest cron (automatic, the model of record — 20 §7.2)
 *
 * Runs on the DRIZZLE path, which BYPASSES RLS (doc 06 §3), so we filter
 * tenant_id in code here. Drafting is service work; review/approve/send happen on
 * the RLS supabase-js staff path. A re-draft NEVER clobbers an already
 * approved/sent note (20 §7.6).
 */

export interface DraftSummary {
  tenantId: string;
  drafted: number; // new draft rows
  updated: number; // existing drafts refreshed
  skipped: number; // no activity, or already approved/sent
  total: number; // active students considered
}

export async function draftWeeklyReportsForTenant(
  tenantId: string,
  today: string = todaySydney(),
): Promise<DraftSummary> {
  const { start, end } = reportWindow(today);

  const [tenant] = await db
    .select({ voice: schema.tenants.voiceSignature })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  const voice: VoiceSignature = tenant?.voice ?? FATIMA_VOICE;

  const studentRows = await db
    .select({
      id: schema.students.id,
      firstName: schema.students.firstName,
      yearLevel: schema.students.yearLevel,
    })
    .from(schema.students)
    .where(
      and(
        eq(schema.students.tenantId, tenantId),
        eq(schema.students.active, true),
      ),
    );
  if (studentRows.length === 0) {
    return { tenantId, drafted: 0, updated: 0, skipped: 0, total: 0 };
  }
  const ids = studentRows.map((s) => s.id);

  // All lessons for these students (windowed in code; full set feeds the streak).
  const lessonRows = await db
    .select({
      studentId: schema.lessons.studentId,
      date: schema.lessons.date,
      status: schema.lessons.status,
      note: schema.lessons.note,
    })
    .from(schema.lessons)
    .where(inArray(schema.lessons.studentId, ids));
  const byStudent = new Map<string, ReportLesson[]>();
  for (const l of lessonRows) {
    const arr = byStudent.get(l.studentId) ?? [];
    arr.push({ date: l.date, status: l.status, note: l.note });
    byStudent.set(l.studentId, arr);
  }

  // Existing notes for this exact period, so we don't duplicate or clobber.
  const existingRows = await db
    .select({
      id: schema.reports.id,
      studentId: schema.reports.studentId,
      status: schema.reports.status,
    })
    .from(schema.reports)
    .where(
      and(
        eq(schema.reports.tenantId, tenantId),
        inArray(schema.reports.studentId, ids),
        eq(schema.reports.periodStart, start),
      ),
    );
  const existing = new Map(existingRows.map((r) => [r.studentId, r]));

  let drafted = 0;
  let updated = 0;
  let skipped = 0;

  for (const s of studentRows) {
    const prior = existing.get(s.id);
    // Never overwrite a note the tutor already approved or sent.
    if (prior && prior.status !== "draft") {
      skipped++;
      continue;
    }

    const stats = weeklyStats(byStudent.get(s.id) ?? [], today);
    const hasActivity =
      stats.present + stats.late + stats.absent + stats.cancelled > 0;
    if (!hasActivity) {
      // Nothing happened this week — no empty note, no wasted API call.
      skipped++;
      continue;
    }

    const report = await generateWeeklyReport({
      voice,
      studentName: s.firstName,
      yearLevel: s.yearLevel ?? undefined,
      stats,
    });

    if (prior) {
      await db
        .update(schema.reports)
        .set({
          greeting: report.greeting,
          body: report.body,
          signoff: report.signoff,
          model: report.model,
          stats,
          periodEnd: end,
          status: "draft",
          createdAt: new Date(),
        })
        .where(eq(schema.reports.id, prior.id));
      updated++;
    } else {
      await db.insert(schema.reports).values({
        tenantId,
        studentId: s.id,
        periodStart: start,
        periodEnd: end,
        status: "draft",
        greeting: report.greeting,
        body: report.body,
        signoff: report.signoff,
        model: report.model,
        stats,
      });
      drafted++;
    }
  }

  return { tenantId, drafted, updated, skipped, total: studentRows.length };
}

/** Every tenant — the weekly Inngest cron's entry point. */
export async function draftWeeklyReportsAllTenants(
  today: string = todaySydney(),
): Promise<DraftSummary[]> {
  const tenantRows = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants);
  const out: DraftSummary[] = [];
  for (const t of tenantRows) {
    out.push(await draftWeeklyReportsForTenant(t.id, today));
  }
  return out;
}
