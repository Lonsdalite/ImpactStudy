"use server";

import { revalidatePath } from "next/cache";
import { resolveActiveTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import {
  generateWeeklyReport as runLLM,
  type WeeklyReport,
} from "@/lib/llm/generate-report";
import { FATIMA_VOICE } from "@/lib/llm/voice";
import { weeklyStats, type ReportLesson, type WeeklyStats } from "@/lib/reports";
import {
  draftWeeklyReportsForTenant,
  type DraftSummary,
} from "@/lib/reports-draft";
import type { VoiceSignature } from "@/lib/voice-types";

function requireStaff(role: string): boolean {
  return ["owner", "admin", "tutor"].includes(role);
}

/**
 * Generate a weekly parent note for one student, on demand (nothing persisted in
 * week 1 — read-only). All reads go through the RLS supabase-js client, so a
 * parent can only ever generate a note for their OWN child: if the studentId
 * isn't visible to them, the student query returns nothing and we error out.
 */
export async function generateWeeklyReport(input: {
  studentId: string;
}): Promise<{
  ok: boolean;
  report?: WeeklyReport;
  stats?: WeeklyStats;
  error?: string;
}> {
  const res = await resolveActiveTenant();
  if (res.status !== "ok") {
    return { ok: false, error: "You need to be signed in to do that." };
  }
  if (!input.studentId) return { ok: false, error: "No student selected." };

  const supabase = await createClient();

  // Student — RLS-scoped. A parent only sees their own children here.
  const { data: studentData } = await supabase
    .from("students")
    .select("id, first_name, year_level")
    .eq("id", input.studentId)
    .single();
  if (!studentData) {
    return { ok: false, error: "Student not found." };
  }
  const student = studentData as unknown as {
    id: string;
    first_name: string;
    year_level: string | null;
  };

  // Tenant voice (fallback to the default until a tenant captures their own).
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("voice_signature")
    .eq("id", res.tenant.tenantId)
    .single();
  const captured = (
    tenantRow as unknown as { voice_signature: VoiceSignature | null } | null
  )?.voice_signature;
  const voice = captured ?? FATIMA_VOICE;

  // Lessons — RLS-scoped to what the caller may see for this student.
  const { data: lessonData } = await supabase
    .from("lessons")
    .select("date, status, note")
    .eq("student_id", input.studentId)
    .order("date", { ascending: false });
  const lessons = (lessonData ?? []) as unknown as ReportLesson[];

  const stats = weeklyStats(lessons);

  try {
    const report = await runLLM({
      voice,
      studentName: student.first_name,
      yearLevel: student.year_level ?? undefined,
      stats,
    });
    return { ok: true, report, stats };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not write the note.",
    };
  }
}

/**
 * Tutor "Draft this week's notes" — runs the heartbeat engine for the active
 * tenant now (the same core the weekly Inngest cron runs). Staff only. Drafts
 * land in the review queue; nothing reaches a parent until approved.
 */
export async function draftWeeklyReports(): Promise<{
  ok: boolean;
  summary?: DraftSummary;
  error?: string;
}> {
  const res = await resolveActiveTenant();
  if (res.status !== "ok" || !requireStaff(res.tenant.role)) {
    return { ok: false, error: "Only tutors and admins can draft notes." };
  }
  try {
    const summary = await draftWeeklyReportsForTenant(res.tenant.tenantId);
    revalidatePath("/dashboard/reports");
    return { ok: true, summary };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Drafting failed.",
    };
  }
}

/** Edit a draft note's text before approving. Staff only (RLS also enforces it). */
export async function editReport(input: {
  reportId: string;
  greeting: string;
  body: string;
  signoff: string;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await resolveActiveTenant();
  if (res.status !== "ok" || !requireStaff(res.tenant.role)) {
    return { ok: false, error: "Not allowed." };
  }
  if (!input.body.trim()) return { ok: false, error: "The note can't be empty." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("reports")
    .update({
      greeting: input.greeting.trim() || null,
      body: input.body.trim(),
      signoff: input.signoff.trim() || null,
    })
    .eq("id", input.reportId);
  if (error) return { ok: false, error: "Couldn't save your edit." };
  revalidatePath("/dashboard/reports");
  return { ok: true };
}

/** Approve a draft — the tutor signs off. Still not visible to parents until sent. */
export async function approveReport(
  reportId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await resolveActiveTenant();
  if (res.status !== "ok" || !requireStaff(res.tenant.role)) {
    return { ok: false, error: "Not allowed." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("reports")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: user?.id ?? null,
    })
    .eq("id", reportId)
    .eq("status", "draft");
  if (error) return { ok: false, error: "Couldn't approve." };
  revalidatePath("/dashboard/reports");
  return { ok: true };
}

/**
 * Send an approved note to the parent. In-app delivery is immediate (the parent
 * sees approved/sent notes on Progress). Email is GATED on the verified custom
 * domain (HEARTBEAT_EMAIL_ENABLED) — best-effort, never blocks the status change.
 */
export async function sendReport(
  reportId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await resolveActiveTenant();
  if (res.status !== "ok" || !requireStaff(res.tenant.role)) {
    return { ok: false, error: "Not allowed." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("reports")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", reportId)
    .in("status", ["approved", "draft"]);
  if (error) return { ok: false, error: "Couldn't send." };

  // Email delivery — only when the verified domain is in place. Best-effort.
  if (process.env.HEARTBEAT_EMAIL_ENABLED === "true") {
    try {
      await emailReport(supabase, reportId);
    } catch {
      // In-app delivery already succeeded; don't fail the action on email.
    }
  }

  revalidatePath("/dashboard/reports");
  return { ok: true };
}

async function emailReport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reportId: string,
): Promise<void> {
  const { data } = await supabase
    .from("reports")
    .select("greeting, body, signoff, student:students(first_name)")
    .eq("id", reportId)
    .single();
  if (!data) return;
  const r = data as unknown as {
    greeting: string | null;
    body: string;
    signoff: string | null;
    student: { first_name: string } | null;
  };

  const { data: links } = await supabase
    .from("reports")
    .select("student_id")
    .eq("id", reportId)
    .single();
  const studentId = (links as unknown as { student_id: string } | null)
    ?.student_id;
  if (!studentId) return;

  const { data: parentRows } = await supabase
    .from("student_parents")
    .select("parent:users(email)")
    .eq("student_id", studentId);
  const emails = ((parentRows ?? []) as unknown as {
    parent: { email: string } | null;
  }[])
    .map((p) => p.parent?.email)
    .filter((e): e is string => !!e);
  if (emails.length === 0) return;

  const { resend, FROM_EMAIL } = await import("@/lib/resend");
  const text = [r.greeting, r.body, r.signoff]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join("\n\n");
  await resend.emails.send({
    from: FROM_EMAIL,
    to: emails,
    subject: `${r.student?.first_name ?? "Your child"}'s week`,
    text,
  });
}
