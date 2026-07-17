"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStudent } from "@/lib/portal.server";
import { signedUrl } from "@/lib/storage";
import { WORKSHEETS_BUCKET, SUBMISSIONS_BUCKET, MAX_SUBMISSION_PAGES } from "@/lib/homework";
import type { SubmissionPage } from "@/lib/homework-types";

/**
 * Student-portal server actions (Slice D — doc 26 §2D).
 *
 * The portal is the pilot's homework loop and nothing else: inbox → download the
 * worksheet → upload your work → read the released feedback. Practice/adaptive is
 * deferred to Phase 1.
 *
 * Every action starts with requireStudent(), which resolves WHICH student the
 * caller is — never trusting a studentId from the client. Combined with the RLS
 * policies (a student's JWT can only insert a submission for themselves, as
 * uploader_role='student'), that is the two-layer enforcement doc 06 §6 asks for:
 * the action refuses it, and if the action were wrong, the database still would.
 */

/** Same allowlist as the tutor path (B.5): images + PDF. An HTML/SVG served back
 *  through a signed URL is stored XSS on the Supabase origin. */
function isAllowedMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return mime.startsWith("image/") || mime === "application/pdf";
}

/**
 * Hand a student a short-lived URL for a worksheet — but ONLY if it is actually
 * assigned to them.
 *
 * This is the join Fable (doc 35b §5.4) said not to attempt as a storage policy,
 * and the reasoning is worth keeping: "is this worksheet assigned to me?" is a
 * relationship between two tables, not a fact recoverable from an object key, and
 * baking it into the path would mean copying the file per student. So the gate
 * lives here, and the bytes are fetched with the tenant's staff-scoped signing
 * path only AFTER the check passes.
 *
 * Two layers again: the `worksheets_select_staff_or_assigned` policy means the
 * lookup below returns nothing for an unassigned worksheet even on the student's
 * own JWT, and this action independently confirms the assignment.
 */
export async function signedWorksheetUrlForStudent(
  worksheetId: string,
): Promise<{ ok: boolean; url?: string; fileName?: string; error?: string }> {
  const me = await requireStudent();
  if (!me) return { ok: false, error: "Not allowed." };
  if (!worksheetId) return { ok: false, error: "No worksheet." };

  const supabase = await createClient();

  // The assignment gate, checked explicitly rather than inferred from the RLS
  // result — so this action stays correct even if the policy is later loosened.
  const { data: assignment } = await supabase
    .from("assignments")
    .select("id")
    .eq("worksheet_id", worksheetId)
    .eq("student_id", me.studentId)
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (!assignment) return { ok: false, error: "That worksheet isn't assigned to you." };

  const { data: worksheet } = await supabase
    .from("worksheets")
    .select("storage_path, file_name")
    .eq("id", worksheetId)
    .maybeSingle();
  const ws = worksheet as unknown as {
    storage_path: string;
    file_name: string;
  } | null;
  if (!ws?.storage_path) return { ok: false, error: "That worksheet isn't available." };

  const url = await signedUrl(WORKSHEETS_BUCKET, ws.storage_path);
  if (!url) return { ok: false, error: "Couldn't open the worksheet. Tell your tutor." };
  return { ok: true, url, fileName: ws.file_name };
}

/**
 * Record work the student uploaded — a Slice C submission, uploader_role
 * 'student'. C cut this seam already (the uploader was polymorphic from the
 * start), so D fills the arm in rather than reworking anything.
 *
 * The files are already in Storage: the browser uploads direct (keeping server
 * action payloads tiny, as the tutor path does) under
 * `${tenantId}/${studentId}/…`, which is the path predicate the student storage
 * policy matches on. This action only stores the keys.
 *
 * "Uploads come from the student account" (§2D) — a parent may operate it for a
 * young child, which is precisely why there is no separate parent-upload UI to
 * build here.
 */
export async function createStudentSubmission(input: {
  assignmentId?: string | null;
  pages: SubmissionPage[];
  note?: string | null;
}): Promise<{ ok: boolean; submissionId?: string; error?: string }> {
  const me = await requireStudent();
  if (!me) return { ok: false, error: "Not allowed." };

  if (!input.pages?.length) {
    return { ok: false, error: "Add at least one photo of your work." };
  }
  if (input.pages.length > MAX_SUBMISSION_PAGES) {
    return { ok: false, error: `Up to ${MAX_SUBMISSION_PAGES} pages at a time.` };
  }
  for (const p of input.pages) {
    if (!isAllowedMime(p.mime)) {
      return { ok: false, error: "Only photos and PDFs can be uploaded." };
    }
    // The path must be under THIS student's own folder. RLS enforces it too;
    // this catches it earlier with a message a child can act on.
    if (!p.path?.startsWith(`${me.tenantId}/${me.studentId}/`) || p.path.includes("..")) {
      return { ok: false, error: "That upload didn't finish — try again." };
    }
  }

  const supabase = await createClient();

  // Resolve the assignment ourselves rather than trusting the id: it must be the
  // caller's own and not archived. Its subject rides along so a standalone
  // submission still shows up under the right subject on Fatima's board.
  let assignmentId: string | null = null;
  let subjectId: string | null = null;
  if (input.assignmentId) {
    const { data } = await supabase
      .from("assignments")
      .select("id, subject_id, status")
      .eq("id", input.assignmentId)
      .eq("student_id", me.studentId)
      .maybeSingle();
    const a = data as unknown as {
      id: string;
      subject_id: string | null;
      status: string;
    } | null;
    if (!a || a.status === "archived") {
      return { ok: false, error: "That task isn't in your list any more." };
    }
    assignmentId = a.id;
    subjectId = a.subject_id;
  }

  const { data, error } = await supabase
    .from("submissions")
    .insert({
      tenant_id: me.tenantId,
      student_id: me.studentId,
      assignment_id: assignmentId,
      subject_id: subjectId,
      uploader_role: "student",
      uploaded_by: me.userId,
      pages: input.pages,
      note: input.note?.trim() || null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[portal] submission insert failed", error);
    return { ok: false, error: "Couldn't hand that in. Try again." };
  }

  // Advance the assignment to `submitted` so it lands in Fatima's "needs
  // correction" column. Guarded on `assigned` so a re-upload never drags an
  // already-corrected task backwards.
  if (assignmentId) {
    await supabase
      .from("assignments")
      .update({ status: "submitted" })
      .eq("id", assignmentId)
      .eq("status", "assigned");
  }

  revalidatePortal(assignmentId);
  // The tutor's board changes too — she has new work to correct.
  revalidatePath("/dashboard/homework");
  revalidatePath(`/dashboard/students/${me.studentId}`);
  return { ok: true, submissionId: (data as unknown as { id: string }).id };
}

/**
 * Take back work just handed in — the undo behind the upload toast (the UX bar:
 * toast-with-undo, not a confirm dialog).
 *
 * Only while untouched: once a correction row exists, Fatima has started marking,
 * and pulling the work out from under her would erase her effort — or, if
 * released, rewrite the record. RLS says the same thing independently
 * (`submissions_delete_student`), so a student poking at PostgREST gets the same
 * refusal rather than a different one.
 */
export async function undoStudentSubmission(
  submissionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireStudent();
  if (!me) return { ok: false, error: "Not allowed." };
  if (!submissionId) return { ok: false, error: "Nothing to undo." };

  const supabase = await createClient();
  const { data } = await supabase
    .from("submissions")
    .select("id, assignment_id, pages, uploader_role")
    .eq("id", submissionId)
    .eq("student_id", me.studentId)
    .maybeSingle();
  const sub = data as unknown as {
    id: string;
    assignment_id: string | null;
    pages: SubmissionPage[] | null;
    uploader_role: string;
  } | null;
  if (!sub) return { ok: false, error: "Nothing to undo." };
  if (sub.uploader_role !== "student") {
    // Work the tutor photographed herself isn't the student's to withdraw.
    return { ok: false, error: "Your tutor added this one — ask her to remove it." };
  }

  const { data: deleted, error } = await supabase
    .from("submissions")
    .delete()
    .eq("id", submissionId)
    .select("id");
  if (error || (deleted ?? []).length === 0) {
    // The RLS delete policy refuses once a correction exists — that's this path.
    return { ok: false, error: "Your tutor has already started marking this one." };
  }

  // Files after the row: an orphaned object is tidier than an orphaned record.
  const paths = (sub.pages ?? []).map((p) => p.path).filter(Boolean);
  if (paths.length > 0) {
    await supabase.storage.from(SUBMISSIONS_BUCKET).remove(paths);
  }

  if (sub.assignment_id) {
    await supabase
      .from("assignments")
      .update({ status: "assigned" })
      .eq("id", sub.assignment_id)
      .eq("status", "submitted");
  }

  revalidatePortal(sub.assignment_id);
  revalidatePath("/dashboard/homework");
  revalidatePath(`/dashboard/students/${me.studentId}`);
  return { ok: true };
}

/** Scoped revalidation, per the C.5 lesson: never the layout hammer. */
function revalidatePortal(assignmentId?: string | null) {
  revalidatePath("/portal");
  if (assignmentId) revalidatePath(`/portal/${assignmentId}`);
}
