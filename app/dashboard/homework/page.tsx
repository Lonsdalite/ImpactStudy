import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import { signedUrls, SUBMISSIONS_BUCKET } from "@/lib/storage";
import { getTenantVoice } from "@/lib/voice.server";
import { nowMs, perfLog, sinceMs } from "@/lib/perf";
import { CorrectionUploader } from "@/components/dashboard/correction-uploader";
import {
  CorrectionReview,
  type CorrectionView,
} from "@/components/dashboard/correction-review";
import {
  PendingSubmissions,
  type PendingSubmission,
} from "@/components/dashboard/pending-submissions";
import { BOARD_COLUMNS, defaultPresetKey } from "@/lib/homework";
import type {
  AssignmentStatus,
  CorrectionStatus,
} from "@/lib/db/schema";
import type {
  CorrectionItem,
  CorrectionMode,
  CorrectionStats,
  SubmissionPage,
} from "@/lib/homework-types";

export const metadata = { title: "Homework" };

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string | null;
}
interface AssignmentRow {
  id: string;
  student_id: string;
  title: string;
  status: AssignmentStatus;
  student: { first_name: string; last_name: string | null } | null;
}
interface CorrectionRow {
  id: string;
  submission_id: string;
  status: CorrectionStatus;
  mode: CorrectionMode | null;
  items: CorrectionItem[] | null;
  voiced_note: string | null;
  stats: CorrectionStats | null;
  model: string | null;
  released_at: string | null;
  submission: { pages: SubmissionPage[] | null } | null;
  student: { first_name: string; last_name: string | null } | null;
}
interface PendingRow {
  id: string;
  pages: SubmissionPage[] | null;
  student: { first_name: string; last_name: string | null } | null;
  subject: { name: string } | null;
}

function fullName(first: string, last: string | null) {
  return `${first}${last ? ` ${last}` : ""}`;
}

export default async function HomeworkPage() {
  const tPage = nowMs();
  const result = await resolveActiveTenant();
  if (result.status !== "ok") {
    redirect(result.status === "none" ? "/login" : "/tenant-select");
  }
  const { tenant } = result;
  const isStaff = ["owner", "admin", "tutor"].includes(tenant.role);

  if (!isStaff) {
    return (
      <main className="flex-1 px-6 py-10 md:px-10">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-display text-3xl tracking-tight text-brand-plum">
            Homework
          </h1>
          <p className="mt-3 text-sm text-brand-ink/65">
            Homework correction is a tutor tool. Returned feedback for your child
            arrives on Progress.
          </p>
        </div>
      </main>
    );
  }

  const supabase = await createClient();

  // Perf timing (Slice C.5 item d — measure first). Logs land in the server
  // terminal; compare before/after the scoped-revalidation + signed-URL-batching
  // changes. Cheap enough to leave in.
  const tQueries = nowMs();
  const [
    { data: studentData },
    { data: assignmentData },
    { data: correctionData },
    { data: pendingData },
    capturedVoice,
    { data: correctedData },
  ] = await Promise.all([
    supabase
      .from("students")
      .select("id, first_name, last_name")
      .eq("tenant_id", tenant.tenantId)
      .eq("active", true)
      .order("first_name", { ascending: true }),
    supabase
      .from("assignments")
      .select("id, student_id, title, status, student:students(first_name, last_name)")
      .eq("tenant_id", tenant.tenantId)
      .neq("status", "archived")
      .order("order_index", { ascending: true }),
    supabase
      .from("corrections")
      .select(
        "id, submission_id, status, mode, items, voiced_note, stats, model, released_at, submission:submissions(pages), student:students(first_name, last_name)",
      )
      .eq("tenant_id", tenant.tenantId)
      .order("updated_at", { ascending: false })
      .limit(30),
    // Submissions for the "ready to evaluate" queue (filtered to un-graded below).
    supabase
      .from("submissions")
      .select("id, pages, student:students(first_name, last_name), subject:subjects(name)")
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: false })
      .limit(30),
    // Drizzle path — `authenticated` has no column privilege on
    // tenants.voice_signature (policies.sql §3, Slice D). Still inside the
    // parallel batch, so it costs no extra round-trip wall-clock (C.5 item d).
    getTenantVoice(tenant.tenantId),
    // "Has a correction?" id-set for the pending queue. An explicit id set is
    // robust (a PostgREST reverse-embed silently returns empty for some
    // runtime rows). Folded into this parallel batch so it isn't a serial
    // round-trip (Slice C.5 item d).
    supabase
      .from("corrections")
      .select("submission_id")
      .eq("tenant_id", tenant.tenantId),
  ]);
  console.log(`[homework] queries(6)=${sinceMs(tQueries)}ms`);

  const students = (studentData ?? []) as unknown as StudentRow[];
  const assignments = (assignmentData ?? []) as unknown as AssignmentRow[];
  const corrections = (correctionData ?? []) as unknown as CorrectionRow[];
  const hasVoice = !!capturedVoice;

  // Uploader inputs.
  const uploaderStudents = students.map((s) => ({
    id: s.id,
    name: fullName(s.first_name, s.last_name),
  }));
  const openAssignments = assignments
    .filter((a) => a.status === "assigned" || a.status === "submitted")
    .map((a) => ({ id: a.id, studentId: a.student_id, title: a.title }));

  // Morning board (cross-student), bucketed by status.
  const board = BOARD_COLUMNS.map((col) => ({
    ...col,
    items: assignments
      .filter((a) => col.statuses.includes(a.status))
      .map((a) => ({
        id: a.id,
        title: a.title,
        name: a.student ? fullName(a.student.first_name, a.student.last_name) : "Student",
      })),
  }));

  const correctedIds = new Set(
    ((correctedData ?? []) as unknown as { submission_id: string }[]).map(
      (r) => r.submission_id,
    ),
  );
  const pending = ((pendingData ?? []) as unknown as PendingRow[]).filter(
    (s) => !correctedIds.has(s.id),
  );

  // Sign EVERY image page across corrections + pending in ONE batch call
  // (Slice C.5 item d — perf). The old code called signedUrls once per
  // correction AND once per pending submission (~60 `createClient()` +
  // `createSignedUrls` round-trips); this collapses to a single call, then maps
  // paths back synchronously.
  const imagePath = (p: SubmissionPage) => p.mime.startsWith("image/");
  const allImagePaths = Array.from(
    new Set([
      ...corrections.flatMap((c) =>
        (c.submission?.pages ?? []).filter(imagePath).map((p) => p.path),
      ),
      ...pending.flatMap((s) =>
        (s.pages ?? []).filter(imagePath).map((p) => p.path),
      ),
    ]),
  );
  const tSign = nowMs();
  const signed = await signedUrls(SUBMISSIONS_BUCKET, allImagePaths);
  console.log(`[homework] sign(${allImagePaths.length})=${sinceMs(tSign)}ms`);
  perfLog("page.homework.total", tPage);
  const urlByPath = new Map<string, string>();
  allImagePaths.forEach((p, i) => {
    const u = signed[i];
    if (u) urlByPath.set(p, u);
  });
  const signUrls = (ps: SubmissionPage[] | null | undefined) =>
    (ps ?? [])
      .filter(imagePath)
      .map((p) => urlByPath.get(p.path))
      .filter((u): u is string => !!u);

  // Correction review views.
  const correctionViews: CorrectionView[] = corrections.map((c) => ({
    id: c.id,
    submissionId: c.submission_id,
    status: c.status,
    mode: c.mode === "language" ? "language" : "marking",
    studentName: c.student
      ? fullName(c.student.first_name, c.student.last_name)
      : "Student",
    items: c.items ?? [],
    voicedNote: c.voiced_note ?? "",
    stats: c.stats,
    model: c.model,
    pageUrls: signUrls(c.submission?.pages),
    releasedAt: c.released_at,
  }));

  // Uploaded-but-not-graded submissions → the "ready to evaluate" queue.
  const pendingViews: PendingSubmission[] = pending.map((s) => ({
    id: s.id,
    studentName: s.student
      ? fullName(s.student.first_name, s.student.last_name)
      : "Student",
    subjectName: s.subject?.name ?? null,
    defaultPresetKey: defaultPresetKey(s.subject?.name),
    pageUrls: signUrls(s.pages),
    pageCount: (s.pages ?? []).length,
  }));

  return (
    <main className="flex-1 px-6 py-10 md:px-10">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-plum-mid">
              {tenant.displayName}
            </p>
            <h1 className="mt-2 font-display text-3xl tracking-tight text-brand-plum sm:text-4xl">
              Homework
            </h1>
            <p className="mt-2 text-sm text-brand-ink/65">
              Correct a page in seconds, and see who owes work at a glance.
            </p>
          </div>
          <Link
            href="/dashboard/homework/library"
            className="rounded-lg border border-brand-plum/30 px-4 py-2 text-sm font-medium text-brand-plum hover:bg-brand-plum/[0.06]"
          >
            Worksheet library →
          </Link>
        </div>

        {!hasVoice ? (
          <div className="mt-6 rounded-xl border border-brand-gold/40 bg-brand-gold/10 px-4 py-3 text-sm text-brand-plum">
            Corrections write feedback in your voice. You haven&apos;t captured
            it yet —{" "}
            <Link href="/dashboard/voice" className="font-medium underline">
              set your voice
            </Link>{" "}
            so the notes sound like you.
          </div>
        ) : null}

        {/* Morning board */}
        <section className="mt-8">
          <h2 className="text-sm font-medium text-brand-plum">Morning board</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {board.map((col) => (
              <div
                key={col.key}
                className="rounded-2xl border border-brand-mist bg-white p-4"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-medium text-brand-ink/60">
                    {col.label}
                  </span>
                  <span className="font-display text-lg text-brand-plum">
                    {col.items.length}
                  </span>
                </div>
                <ul className="mt-2 flex flex-col gap-1">
                  {col.items.slice(0, 6).map((it) => (
                    <li key={it.id} className="truncate text-xs text-brand-ink/70">
                      <span className="font-medium text-brand-plum">{it.name}</span>{" "}
                      · {it.title}
                    </li>
                  ))}
                  {col.items.length === 0 ? (
                    <li className="text-xs text-brand-ink/40">—</li>
                  ) : null}
                  {col.items.length > 6 ? (
                    <li className="text-xs text-brand-ink/40">
                      +{col.items.length - 6} more
                    </li>
                  ) : null}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Correction workstation */}
        <section className="mt-8">
          <CorrectionUploader
            tenantId={tenant.tenantId}
            students={uploaderStudents}
            openAssignments={openAssignments}
          />
        </section>

        {/* Uploaded, awaiting AI evaluation */}
        <PendingSubmissions submissions={pendingViews} />

        <section className="mt-6">
          <h2 className="text-sm font-medium text-brand-plum">
            Drafts to review
          </h2>
          <p className="mt-1 text-xs text-brand-ink/55">
            The AI drafts every mark. Nothing goes out until you return it.
          </p>
          <div className="mt-4">
            <CorrectionReview corrections={correctionViews} />
          </div>
        </section>
      </div>
    </main>
  );
}
