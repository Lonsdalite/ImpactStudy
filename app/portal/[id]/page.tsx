import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireStudent } from "@/lib/portal.server";
import { createClient } from "@/lib/supabase/server";
import { signedUrls, SUBMISSIONS_BUCKET } from "@/lib/storage";
import { shortDate, todaySydney } from "@/lib/billing";
import { statsLine } from "@/lib/homework";
import { StudentUploader } from "@/components/portal/student-uploader";
import { WorksheetLink } from "@/components/portal/worksheet-link";
import { StudentFeedback } from "@/components/portal/student-feedback";
import type { AssignmentStatus } from "@/lib/db/schema";
import type {
  CorrectionItem,
  CorrectionMode,
  CorrectionStats,
  SubmissionPage,
} from "@/lib/homework-types";

/**
 * One assignment: the worksheet to download, the upload box, and — once Fatima
 * RELEASES it — the correction and her voiced note.
 *
 * The full loop from doc 26 (C + D as one system) ends on this page: assignment
 * created in C's tracker → inbox → student uploads → C correction → Fatima
 * reviews/releases → the student reads it here.
 */

interface AssignmentRow {
  id: string;
  title: string;
  status: AssignmentStatus;
  due_date: string | null;
  note: string | null;
  worksheet_id: string | null;
  subject: { name: string } | null;
}

interface SubmissionRow {
  id: string;
  pages: SubmissionPage[];
  created_at: string;
  uploader_role: string;
}

interface CorrectionRow {
  id: string;
  submission_id: string;
  mode: CorrectionMode;
  items: CorrectionItem[];
  voiced_note: string | null;
  stats: CorrectionStats | null;
  released_at: string | null;
}

export const metadata = { title: "Homework" };

export default async function PortalAssignmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireStudent();
  if (!me) redirect("/dashboard");
  const { id } = await params;

  const today = todaySydney();
  const supabase = await createClient();

  const { data: assignmentData } = await supabase
    .from("assignments")
    .select("id, title, status, due_date, note, worksheet_id, subject:subjects(name)")
    .eq("id", id)
    .eq("student_id", me.studentId)
    .maybeSingle();
  const assignment = assignmentData as unknown as AssignmentRow | null;
  // Another student's assignment id lands here identically to a deleted one —
  // RLS returns no row, and 404 is the honest answer either way. Note it never
  // reaches the DB as "someone else's": the query is pinned to me.studentId.
  if (!assignment || assignment.status === "archived") notFound();

  // Everything already handed in for this task, plus any released correction on
  // it. Drafts are invisible here at the DB (corrections_select_staff_or_student
  // gates on `released`), so a child can never read an AI draft Fatima hasn't
  // reviewed — the same trust spine as reports' `sent`.
  const [{ data: submissionData }, { data: correctionData }] = await Promise.all([
    supabase
      .from("submissions")
      .select("id, pages, created_at, uploader_role")
      .eq("assignment_id", assignment.id)
      .eq("student_id", me.studentId)
      .order("created_at", { ascending: false }),
    supabase
      .from("corrections")
      .select("id, submission_id, mode, items, voiced_note, stats, released_at")
      .eq("student_id", me.studentId)
      .eq("status", "released"),
  ]);
  const submissions = (submissionData ?? []) as unknown as SubmissionRow[];
  const corrections = (correctionData ?? []) as unknown as CorrectionRow[];

  const submissionIds = new Set(submissions.map((s) => s.id));
  const released = corrections.filter((c) => submissionIds.has(c.submission_id));

  // Batch the signing — one round-trip for every page on the screen, not one per
  // thumbnail (the C.5 item-d finding: batching measured 9× faster).
  const allPages = submissions.flatMap((s) => s.pages ?? []);
  const urls = await signedUrls(
    SUBMISSIONS_BUCKET,
    allPages.map((p) => p.path),
  );
  const urlByPath = new Map(allPages.map((p, i) => [p.path, urls[i]]));

  const latest = submissions[0];
  const handedIn = submissions.length > 0;
  const due = assignment.due_date;

  return (
    <main className="flex-1 px-5 py-8">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/portal"
          className="inline-flex min-h-11 items-center text-sm text-brand-plum-mid underline-offset-4 hover:underline"
        >
          ← All homework
        </Link>

        <h1 className="mt-2 font-display text-2xl leading-tight tracking-tight text-brand-plum sm:text-3xl">
          {assignment.title}
        </h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-brand-ink/55">
          {assignment.subject?.name ? <span>{assignment.subject.name}</span> : null}
          {assignment.subject?.name && due ? <span aria-hidden>·</span> : null}
          {due ? (
            <span className={due < today ? "text-red-600" : undefined}>
              {due < today ? `Was due ${shortDate(due)}` : `Due ${shortDate(due)}`}
            </span>
          ) : null}
        </p>

        {assignment.note ? (
          <p className="mt-4 rounded-xl border border-brand-mist bg-brand-cream/40 px-4 py-3 text-sm leading-relaxed text-brand-ink/80">
            {assignment.note}
          </p>
        ) : null}

        {/* 1. The worksheet. The URL is minted on tap by a server action that
            checks the assignment first — an assignment-gated join, not a storage
            path predicate (doc 35b §5.4). */}
        {assignment.worksheet_id ? (
          <section className="mt-6">
            <WorksheetLink worksheetId={assignment.worksheet_id} />
          </section>
        ) : null}

        {/* 2. Hand it in. */}
        <section className="mt-6">
          <StudentUploader
            assignmentId={assignment.id}
            tenantId={me.tenantId}
            studentId={me.studentId}
            hasSubmission={handedIn}
          />
        </section>

        {/* 3. What you handed in. */}
        {handedIn ? (
          <section className="mt-8">
            <h2 className="text-sm font-medium text-brand-plum">
              What you handed in
            </h2>
            <p className="mt-1 text-xs text-brand-ink/50">
              {shortDate(latest.created_at.slice(0, 10))}
              {latest.uploader_role === "tutor"
                ? " · added by your tutor"
                : null}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {submissions.flatMap((s) =>
                (s.pages ?? []).map((p) => {
                  const url = urlByPath.get(p.path);
                  if (!url) return null;
                  return p.mime === "application/pdf" ? (
                    <a
                      key={p.path}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-11 items-center rounded-lg border border-brand-mist bg-white px-3 text-sm text-brand-plum-mid hover:border-brand-plum/30"
                    >
                      {p.name}
                    </a>
                  ) : (
                    <a
                      key={p.path}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      {/* Signed Supabase URLs are remote + short-lived, so a
                          plain <img> beats next/image here (no optimiser round
                          trip on a URL that expires in 30 min). */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={p.name}
                        className="h-24 w-24 rounded-lg border border-brand-mist object-cover"
                      />
                    </a>
                  );
                }),
              )}
            </div>
          </section>
        ) : null}

        {/* 4. The feedback — released only. */}
        {released.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-sm font-medium text-brand-plum">
              Your tutor&apos;s feedback
            </h2>
            <div className="mt-3 flex flex-col gap-4">
              {released.map((c) => (
                <StudentFeedback
                  key={c.id}
                  mode={c.mode}
                  items={c.items ?? []}
                  voicedNote={c.voiced_note}
                  summary={c.stats ? statsLine(c.stats, c.mode) : null}
                  releasedAt={c.released_at}
                />
              ))}
            </div>
          </section>
        ) : handedIn ? (
          <p className="mt-8 rounded-xl border border-brand-mist bg-white px-4 py-3 text-sm text-brand-ink/60">
            Handed in. Your tutor will mark this and the feedback will show up
            here.
          </p>
        ) : null}
      </div>
    </main>
  );
}
