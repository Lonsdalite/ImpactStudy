import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  ReportReview,
  type ReviewReport,
} from "@/components/dashboard/report-review";
import {
  microWin,
  reportWindow,
  weeklyStats,
  type ReportLesson,
} from "@/lib/reports";
import { shortDate, todaySydney } from "@/lib/billing";
import type { LessonStatus, ReportStatus } from "@/lib/db/schema";

export const metadata = { title: "Reports" };

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string | null;
}
interface LessonRow {
  student_id: string;
  date: string;
  status: LessonStatus;
  note: string | null;
}
interface ReportRow {
  id: string;
  student_id: string;
  status: ReportStatus;
  greeting: string | null;
  body: string;
  signoff: string | null;
  sent_at: string | null;
  period_start: string;
  period_end: string;
  student: { first_name: string; last_name: string | null } | null;
}

function fullName(first: string, last: string | null) {
  return `${first}${last ? ` ${last}` : ""}`;
}

export default async function ReportsPage() {
  const result = await resolveActiveTenant();
  if (result.status !== "ok") {
    redirect(result.status === "none" ? "/login" : "/tenant-select");
  }
  const { tenant } = result;
  const isStaff = ["owner", "admin", "tutor"].includes(tenant.role);
  const today = todaySydney();
  const { start, end } = reportWindow(today);

  const supabase = await createClient();
  const { data: studentData } = await supabase
    .from("students")
    .select("id, first_name, last_name")
    .eq("tenant_id", tenant.tenantId)
    .eq("active", true)
    .order("first_name", { ascending: true });
  const students = (studentData ?? []) as unknown as StudentRow[];

  // This week's lessons for every visible student → deterministic win cards.
  const lessonsByStudent = new Map<string, ReportLesson[]>();
  if (students.length > 0) {
    const ids = students.map((s) => s.id);
    const { data: lessonData } = await supabase
      .from("lessons")
      .select("student_id, date, status, note")
      .in("student_id", ids)
      .order("date", { ascending: false });
    for (const l of (lessonData ?? []) as unknown as LessonRow[]) {
      const arr = lessonsByStudent.get(l.student_id) ?? [];
      arr.push({ date: l.date, status: l.status, note: l.note });
      lessonsByStudent.set(l.student_id, arr);
    }
  }

  const cards = students.map((s) => ({
    id: s.id,
    name: fullName(s.first_name, s.last_name),
    firstName: s.first_name,
    stats: weeklyStats(lessonsByStudent.get(s.id) ?? [], today),
  }));

  return (
    <main className="flex-1 px-6 py-10 md:px-10">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-plum-mid">
          {tenant.displayName}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-brand-plum sm:text-4xl">
          {isStaff ? "Reports" : "Progress"}
        </h1>
        <p className="mt-2 text-sm text-brand-ink/65">
          {isStaff
            ? "Draft this week's parent notes from what you logged, review, and send — in your voice."
            : "This week's wins, and a note from your tutor."}
        </p>

        {students.length === 0 ? (
          <div className="mt-10">
            <EmptyState
              title={isStaff ? "No students yet" : "No children linked yet"}
              body={
                isStaff
                  ? "Add students and mark attendance, then draft weekly progress notes here."
                  : "Once your tutor links a child to your account, their progress shows up here."
              }
            />
          </div>
        ) : isStaff ? (
          <StaffView
            tenantId={tenant.tenantId}
            periodStart={start}
            periodLabel={`Week of ${shortDate(start)} – ${shortDate(end)}`}
            cards={cards}
          />
        ) : (
          <ParentView childIds={students.map((s) => s.id)} cards={cards} />
        )}
      </div>
    </main>
  );
}

async function StaffView({
  tenantId,
  periodStart,
  periodLabel,
  cards,
}: {
  tenantId: string;
  periodStart: string;
  periodLabel: string;
  cards: {
    id: string;
    name: string;
    firstName: string;
    stats: ReturnType<typeof weeklyStats>;
  }[];
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reports")
    .select(
      "id, student_id, status, greeting, body, signoff, sent_at, period_start, period_end, student:students(first_name, last_name)",
    )
    .eq("tenant_id", tenantId)
    .eq("period_start", periodStart)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as unknown as ReportRow[];

  const reports: ReviewReport[] = rows.map((r) => ({
    id: r.id,
    studentName: r.student
      ? fullName(r.student.first_name, r.student.last_name)
      : "Student",
    status: r.status,
    greeting: r.greeting ?? "",
    body: r.body,
    signoff: r.signoff ?? "",
    sentAt: r.sent_at,
  }));

  return (
    <>
      <section className="mt-8">
        <ReportReview periodLabel={periodLabel} reports={reports} />
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-brand-plum">
          This week at a glance
        </h2>
        <div className="mt-4 overflow-hidden rounded-2xl border border-brand-mist bg-white">
          <ul className="divide-y divide-brand-mist">
            {cards.map((c) => (
              <li key={c.id} className="px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium text-brand-plum">{c.name}</span>
                  <span className="text-xs text-brand-ink/55">
                    {c.stats.attended}/{c.stats.totalScheduled} attended
                  </span>
                </div>
                <p className="mt-1 text-sm text-brand-ink/70">
                  {microWin(c.stats, c.firstName)}
                </p>
                {c.stats.notes[0] ? (
                  <p className="mt-1 text-xs italic text-brand-ink/50">
                    {shortDate(c.stats.notes[0].date)}: {c.stats.notes[0].note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

async function ParentView({
  childIds,
  cards,
}: {
  childIds: string[];
  cards: {
    id: string;
    name: string;
    firstName: string;
    stats: ReturnType<typeof weeklyStats>;
  }[];
}) {
  const supabase = await createClient();
  // A parent only ever sees a note the tutor has SENT — never a draft, and not
  // an internally-approved-but-unsent one. RLS enforces this at the DB; we filter
  // by status here too for clarity.
  const { data } = await supabase
    .from("reports")
    .select(
      "id, student_id, status, greeting, body, signoff, sent_at, period_start, period_end, student:students(first_name, last_name)",
    )
    .in("student_id", childIds)
    .eq("status", "sent")
    .order("period_start", { ascending: false });
  const rows = (data ?? []) as unknown as ReportRow[];

  // Latest note per child.
  const latest = new Map<string, ReportRow>();
  for (const r of rows) if (!latest.has(r.student_id)) latest.set(r.student_id, r);

  return (
    <div className="mt-8 flex flex-col gap-6">
      {cards.map((c) => {
        const note = latest.get(c.id);
        return (
          <section
            key={c.id}
            className="rounded-2xl border border-brand-mist bg-white p-6"
          >
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-xl text-brand-plum">{c.name}</h2>
              <span className="text-xs text-brand-ink/55">
                {c.stats.attended}/{c.stats.totalScheduled} this week
              </span>
            </div>
            <p className="mt-2 text-sm text-brand-ink/75">
              {microWin(c.stats, c.firstName)}
            </p>

            {note ? (
              <div className="mt-4 rounded-xl border border-brand-mist bg-brand-cream/40 p-4">
                {note.greeting ? (
                  <p className="text-sm leading-relaxed text-brand-ink/85">
                    {note.greeting}
                  </p>
                ) : null}
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-brand-ink/85">
                  {note.body}
                </p>
                {note.signoff ? (
                  <p className="mt-2 text-sm leading-relaxed text-brand-ink/85">
                    {note.signoff}
                  </p>
                ) : null}
                <p className="mt-3 border-t border-brand-mist pt-2 text-xs text-brand-ink/45">
                  Week of {shortDate(note.period_start)} –{" "}
                  {shortDate(note.period_end)}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-brand-ink/45">
                A progress note from your tutor will appear here each week.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
