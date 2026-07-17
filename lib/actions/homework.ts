"use server";

import { revalidatePath } from "next/cache";
import { resolveActiveTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { FATIMA_VOICE } from "@/lib/llm/voice";
import { getTenantVoice } from "@/lib/voice.server";
import { gradeSubmission, type GradePage } from "@/lib/llm/grade-submission";
import { downloadBase64, SUBMISSIONS_BUCKET } from "@/lib/storage";
import {
  tallyItems,
  type CorrectionItem,
  type CorrectionMode,
  type CorrectionStats,
  type SubmissionPage,
} from "@/lib/homework-types";
import { MAX_SUBMISSION_PAGES } from "@/lib/homework";

/**
 * Homework + AI-correction server actions (Slice C). All reads/writes ride the
 * RLS supabase-js server client (staff path). Correction is the one heavy
 * action — it downloads the pages from Storage and runs the grading model.
 *
 * Trust spine (doc 26 §2C): draftCorrection only ever writes a DRAFT; nothing
 * reaches a parent until releaseCorrection flips it to `released`.
 */

async function requireStaff() {
  const res = await resolveActiveTenant();
  if (res.status !== "ok") return null;
  if (!["owner", "admin", "tutor"].includes(res.tenant.role)) return null;
  return res.tenant;
}

/**
 * Upload hardening (Slice B.5 / Fable §1 Storage):
 *  - MIME allowlist: images + PDF only. An uploaded HTML/SVG served back via a
 *    signed URL would be stored XSS on the Supabase origin.
 *  - Path prefix: the object key MUST live under the ACTIVE tenant's folder —
 *    a two-tenant staff member could otherwise cross-link records to the other
 *    tenant's objects.
 */
function isAllowedMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return mime.startsWith("image/") || mime === "application/pdf";
}

function isTenantPath(path: string | null | undefined, tenantId: string): boolean {
  return !!path && path.startsWith(`${tenantId}/`) && !path.includes("..");
}

/**
 * Scoped homework revalidation (Slice C.5 item d — perf). The old
 * `revalidatePath("/dashboard", "layout")` was a hammer: it invalidates the
 * ENTIRE /dashboard subtree cache AND re-runs the shell layout's getUser() +
 * memberships-join on every homework tap, then re-renders the whole shell. The
 * only surfaces a homework mutation changes are the Homework hub (board +
 * drafts + pending) and the touched student's pipeline — revalidate exactly
 * those, page-scoped, never the layout. When the studentId isn't known cheaply,
 * fall back to the dynamic-route form (marks all student detail pages stale
 * without re-running the layout). */
function revalidateHomework(studentId?: string | null) {
  revalidatePath("/dashboard/homework");
  if (studentId) revalidatePath(`/dashboard/students/${studentId}`);
  else revalidatePath("/dashboard/students/[id]", "page");
}

// ---------------------------------------------------------------------------
// Worksheets (tenant library)
// ---------------------------------------------------------------------------

/** Record a worksheet whose file was already uploaded to the `worksheets`
 *  bucket (client-side, under `${tenantId}/…`). */
export async function createWorksheet(input: {
  title: string;
  subjectId?: string | null;
  yearLevel?: string | null;
  topic?: string | null;
  storagePath: string;
  fileName: string;
  fileMime: string;
}): Promise<{ ok: boolean; error?: string }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, error: "Only tutors and admins can do this." };
  if (!input.title?.trim()) return { ok: false, error: "Give the worksheet a title." };
  if (!input.storagePath || !input.fileName) {
    return { ok: false, error: "The file didn't upload — try again." };
  }
  if (!isAllowedMime(input.fileMime)) {
    return { ok: false, error: "Only images and PDFs can be worksheets." };
  }
  if (!isTenantPath(input.storagePath, tenant.tenantId)) {
    return { ok: false, error: "The file didn't upload — try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("worksheets").insert({
    tenant_id: tenant.tenantId,
    title: input.title.trim(),
    subject_id: input.subjectId || null,
    year_level: input.yearLevel?.trim() || null,
    topic: input.topic?.trim() || null,
    storage_path: input.storagePath,
    file_name: input.fileName,
    file_mime: input.fileMime,
  });
  if (error) return { ok: false, error: "Couldn't save the worksheet." };
  revalidatePath("/dashboard/homework/library");
  return { ok: true };
}

export async function setWorksheetActive(
  worksheetId: string,
  active: boolean,
): Promise<{ ok: boolean }> {
  if (!(await requireStaff())) return { ok: false };
  if (!worksheetId) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from("worksheets")
    .update({ active })
    .eq("id", worksheetId);
  revalidatePath("/dashboard/homework/library");
  return { ok: !error };
}

// ---------------------------------------------------------------------------
// Assignments (per-student pipeline)
// ---------------------------------------------------------------------------

/** Place a worksheet (or an ad-hoc task) in a student's queue. */
export async function createAssignment(input: {
  studentId: string;
  worksheetId?: string | null;
  title?: string | null;
  subjectId?: string | null;
  enrollmentId?: string | null;
  dueDate?: string | null;
  note?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, error: "Not allowed." };
  if (!input.studentId) return { ok: false, error: "No student." };

  const supabase = await createClient();

  // Resolve a title + subject from the worksheet when assigning from the library.
  let title = input.title?.trim() || "";
  let subjectId = input.subjectId || null;
  if (input.worksheetId) {
    const { data } = await supabase
      .from("worksheets")
      .select("title, subject_id")
      .eq("id", input.worksheetId)
      .single();
    const ws = data as unknown as { title: string; subject_id: string | null } | null;
    if (ws) {
      if (!title) title = ws.title;
      if (!subjectId) subjectId = ws.subject_id;
    }
  }
  if (!title) return { ok: false, error: "Give the assignment a title (or pick a worksheet)." };

  const { error } = await supabase.from("assignments").insert({
    tenant_id: tenant.tenantId,
    student_id: input.studentId,
    worksheet_id: input.worksheetId || null,
    subject_id: subjectId,
    enrollment_id: input.enrollmentId || null,
    title,
    due_date: input.dueDate || null,
    note: input.note?.trim() || null,
  });
  if (error) return { ok: false, error: "Couldn't create the assignment." };
  revalidateHomework(input.studentId);
  return { ok: true };
}

/** Pin an assignment to the front of the student's queue ("up next"). */
export async function moveAssignmentUpNext(
  assignmentId: string,
): Promise<{ ok: boolean }> {
  if (!(await requireStaff())) return { ok: false };
  if (!assignmentId) return { ok: false };
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("assignments")
    .select("student_id")
    .eq("id", assignmentId)
    .single();
  const studentId = (row as unknown as { student_id: string } | null)?.student_id;
  if (!studentId) return { ok: false };

  const { data: mins } = await supabase
    .from("assignments")
    .select("order_index")
    .eq("student_id", studentId)
    .order("order_index", { ascending: true })
    .limit(1);
  const min =
    (mins as unknown as { order_index: number }[] | null)?.[0]?.order_index ?? 1000;

  const { error } = await supabase
    .from("assignments")
    .update({ order_index: min - 1 })
    .eq("id", assignmentId);
  revalidateHomework(studentId);
  return { ok: !error };
}

export async function setAssignmentStatus(
  assignmentId: string,
  status: "assigned" | "submitted" | "corrected" | "returned" | "archived",
): Promise<{ ok: boolean }> {
  if (!(await requireStaff())) return { ok: false };
  if (!assignmentId) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from("assignments")
    .update({ status })
    .eq("id", assignmentId);
  revalidateHomework();
  return { ok: !error };
}

// ---------------------------------------------------------------------------
// Submissions (the unit of record — may stand alone)
// ---------------------------------------------------------------------------

/** Record an uploaded submission (files already in the `submissions` bucket).
 *  If it attaches to an assignment, advance that assignment to `submitted`. */
export async function createSubmission(input: {
  studentId: string;
  assignmentId?: string | null;
  subjectId?: string | null;
  pages: SubmissionPage[];
  note?: string | null;
}): Promise<{ ok: boolean; submissionId?: string; error?: string }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, error: "Not allowed." };
  if (!input.studentId) return { ok: false, error: "Pick a student." };
  if (!input.pages || input.pages.length === 0) {
    return { ok: false, error: "Upload at least one photo or PDF." };
  }
  if (input.pages.length > MAX_SUBMISSION_PAGES) {
    return {
      ok: false,
      error: `Up to ${MAX_SUBMISSION_PAGES} pages per submission.`,
    };
  }
  for (const p of input.pages) {
    if (!isAllowedMime(p.mime)) {
      return { ok: false, error: "Only photos and PDFs can be submitted." };
    }
    if (!isTenantPath(p.path, tenant.tenantId)) {
      return { ok: false, error: "The upload didn't finish — try again." };
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("submissions")
    .insert({
      tenant_id: tenant.tenantId,
      student_id: input.studentId,
      assignment_id: input.assignmentId || null,
      subject_id: input.subjectId || null,
      uploader_role: "tutor",
      uploaded_by: user?.id ?? null,
      pages: input.pages,
      note: input.note?.trim() || null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't save the submission." };

  if (input.assignmentId) {
    await supabase
      .from("assignments")
      .update({ status: "submitted" })
      .eq("id", input.assignmentId)
      .eq("status", "assigned");
  }

  const submissionId = (data as unknown as { id: string }).id;
  revalidateHomework(input.studentId);
  return { ok: true, submissionId };
}

/** Throw away a submission (and its draft correction, via cascade) + its stored
 *  files. If it was attached to an assignment, that assignment goes back to
 *  `assigned` (the work is gone). Used by the "Discard" actions on a pending
 *  submission and on a draft correction. */
export async function discardSubmission(
  submissionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, error: "Not allowed." };
  if (!submissionId) return { ok: false, error: "No submission." };

  const supabase = await createClient();
  const { data } = await supabase
    .from("submissions")
    .select("assignment_id, student_id, pages")
    .eq("id", submissionId)
    .single();
  const sub = data as unknown as {
    assignment_id: string | null;
    student_id: string | null;
    pages: SubmissionPage[] | null;
  } | null;

  // Remove the stored page files (best-effort — don't block the discard on it).
  const paths = (sub?.pages ?? []).map((p) => p.path).filter(Boolean);
  if (paths.length > 0) {
    await supabase.storage.from(SUBMISSIONS_BUCKET).remove(paths);
  }

  // Delete the submission — the correction cascades (FK onDelete cascade).
  const { error } = await supabase
    .from("submissions")
    .delete()
    .eq("id", submissionId);
  if (error) return { ok: false, error: "Couldn't discard." };

  if (sub?.assignment_id) {
    await supabase
      .from("assignments")
      .update({ status: "assigned" })
      .eq("id", sub.assignment_id);
  }

  revalidateHomework(sub?.student_id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Corrections (AI draft → tutor review → release)
// ---------------------------------------------------------------------------

/** Draft a correction for a submission: download the pages, run the grading
 *  model, and persist a DRAFT correction. Never releases.
 *
 *  Slice C.5 (doc 36 item b): `mode` selects the output model (marking |
 *  language, default marking) and `instruction` is the optional free-text
 *  "Anything specific?" note appended to the grader prompt. */
export async function draftCorrection(input: {
  submissionId: string;
  mode?: CorrectionMode;
  instruction?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, error: "Not allowed." };
  if (!input.submissionId) return { ok: false, error: "No submission." };
  // Whitelist the mode; anything unexpected falls back to the safe default.
  const mode: CorrectionMode = input.mode === "language" ? "language" : "marking";
  const instruction = (input.instruction ?? "").trim().slice(0, 500);

  const supabase = await createClient();

  // Submission + its student + subject + optional assignment title.
  const { data: subData } = await supabase
    .from("submissions")
    .select(
      "id, student_id, pages, student:students(first_name, year_level), subject:subjects(name), assignment:assignments(title)",
    )
    .eq("id", input.submissionId)
    .single();
  if (!subData) return { ok: false, error: "Submission not found." };
  const submission = subData as unknown as {
    id: string;
    student_id: string;
    pages: SubmissionPage[];
    student: { first_name: string; year_level: string | null } | null;
    subject: { name: string } | null;
    assignment: { title: string } | null;
  };

  // Guard against re-drafting over an already-returned correction.
  const { data: existing } = await supabase
    .from("corrections")
    .select("id, status")
    .eq("submission_id", input.submissionId)
    .maybeSingle();
  const existingRow = existing as unknown as { id: string; status: string } | null;
  if (existingRow?.status === "released") {
    return {
      ok: false,
      error: "This is already returned. Edit it instead of re-drafting.",
    };
  }

  // Tenant voice (fall back to the default until captured). Drizzle path —
  // `authenticated` has no column privilege on tenants.voice_signature
  // (policies.sql §3). Staff-gated above.
  const voice = (await getTenantVoice(tenant.tenantId)) ?? FATIMA_VOICE;

  // Pull the page bytes from Storage. Skip any that can't be read (e.g. a seeded
  // placeholder with no real file) rather than failing the whole draft.
  const pages: GradePage[] = [];
  for (const p of submission.pages ?? []) {
    try {
      const { base64, mime } = await downloadBase64(SUBMISSIONS_BUCKET, p.path);
      pages.push({ base64, mime: mime || p.mime });
    } catch {
      // skip unreadable page
    }
  }
  if (pages.length === 0) {
    return {
      ok: false,
      error: "Couldn't read any of the uploaded pages. Re-upload and try again.",
    };
  }

  let graded;
  try {
    graded = await gradeSubmission({
      voice,
      pages,
      mode,
      instruction,
      // Privacy (doc 35e §1): first name only into the prompt, never a full
      // legal name.
      studentName: submission.student?.first_name,
      yearLevel: submission.student?.year_level ?? undefined,
      subject: submission.subject?.name,
      assignmentTitle: submission.assignment?.title,
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Grading failed.",
    };
  }

  const nowIso = new Date().toISOString();
  const row = {
    tenant_id: tenant.tenantId,
    submission_id: input.submissionId,
    student_id: submission.student_id,
    status: "draft" as const,
    mode: graded.mode,
    items: graded.items,
    voiced_note: graded.voicedNote,
    stats: graded.stats,
    model: graded.model,
    updated_at: nowIso,
  };

  if (existingRow) {
    await supabase.from("corrections").update(row).eq("id", existingRow.id);
  } else {
    await supabase.from("corrections").insert(row);
  }

  // Advance the linked assignment to `corrected` (a draft exists to review).
  const { data: subRow } = await supabase
    .from("submissions")
    .select("assignment_id")
    .eq("id", input.submissionId)
    .single();
  const assignmentId = (subRow as unknown as { assignment_id: string | null } | null)
    ?.assignment_id;
  if (assignmentId) {
    await supabase
      .from("assignments")
      .update({ status: "corrected" })
      .eq("id", assignmentId)
      .in("status", ["assigned", "submitted"]);
  }

  revalidateHomework(submission.student_id);
  return { ok: true };
}

/** Edit a draft correction's items + voiced note before release. Stats are
 *  recomputed MODE-AWARE (doc 36 item b): marking → verdict tally; language →
 *  reviewed/suggestions, preserving the model's original `reviewed` count (the
 *  tutor editing flagged items doesn't change how many sentences were read). */
export async function editCorrection(input: {
  correctionId: string;
  items: CorrectionItem[];
  voicedNote: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireStaff())) return { ok: false, error: "Not allowed." };
  if (!input.correctionId) return { ok: false, error: "No correction." };
  const supabase = await createClient();

  // Read the mode + the existing reviewed count so language stats stay right.
  const { data: existing } = await supabase
    .from("corrections")
    .select("mode, stats, student_id")
    .eq("id", input.correctionId)
    .single();
  const row = existing as unknown as {
    mode: CorrectionMode | null;
    stats: CorrectionStats | null;
    student_id: string | null;
  } | null;
  const mode: CorrectionMode = row?.mode === "language" ? "language" : "marking";
  const reviewed = row?.stats?.reviewed;

  const { error } = await supabase
    .from("corrections")
    .update({
      items: input.items,
      voiced_note: input.voicedNote.trim() || null,
      stats: tallyItems(input.items, mode, reviewed),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.correctionId);
  if (error) return { ok: false, error: "Couldn't save your edits." };
  revalidateHomework(row?.student_id);
  return { ok: true };
}

/** Release a correction to the student/parent. Freezes the stats snapshot and
 *  marks the linked assignment `returned`. Review-before-release: this is the
 *  only path that makes a correction visible beyond staff. */
export async function releaseCorrection(
  correctionId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireStaff())) return { ok: false, error: "Not allowed." };
  if (!correctionId) return { ok: false, error: "No correction." };
  const supabase = await createClient();

  const { data } = await supabase
    .from("corrections")
    .select("items, submission_id, student_id, mode, stats")
    .eq("id", correctionId)
    .single();
  const row = data as unknown as {
    items: CorrectionItem[];
    submission_id: string;
    student_id: string | null;
    mode: CorrectionMode | null;
    stats: CorrectionStats | null;
  } | null;
  if (!row) return { ok: false, error: "Correction not found." };
  const mode: CorrectionMode = row.mode === "language" ? "language" : "marking";

  const { error } = await supabase
    .from("corrections")
    .update({
      status: "released",
      // Freeze the stats snapshot at release (mode-aware).
      stats: tallyItems(row.items ?? [], mode, row.stats?.reviewed),
      released_at: new Date().toISOString(),
    })
    .eq("id", correctionId);
  if (error) return { ok: false, error: "Couldn't release." };

  // Mark the linked assignment returned.
  const { data: subRow } = await supabase
    .from("submissions")
    .select("assignment_id")
    .eq("id", row.submission_id)
    .single();
  const assignmentId = (subRow as unknown as { assignment_id: string | null } | null)
    ?.assignment_id;
  if (assignmentId) {
    await supabase
      .from("assignments")
      .update({ status: "returned" })
      .eq("id", assignmentId);
  }

  revalidateHomework(row.student_id);
  return { ok: true };
}
