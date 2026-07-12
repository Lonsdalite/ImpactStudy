import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import {
  cycleLabel,
  formatDuration,
  formatMoney,
  nextCollection,
  relativeDay,
  shortDate,
  todaySydney,
} from "@/lib/billing";
import { BillingSettingsForm } from "@/components/dashboard/billing-settings-form";
import { UndoPaymentButton } from "@/components/dashboard/undo-payment-button";
import { StudentAdmin } from "@/components/dashboard/student-admin";
import {
  EnrollmentsManager,
  type EnrollmentRow,
  type SubjectOption,
} from "@/components/dashboard/enrollments-manager";
import {
  AssignmentTracker,
  type TrackerAssignment,
  type TrackerWorksheet,
} from "@/components/dashboard/assignment-tracker";
import type {
  AssignmentStatus,
  BillingCycle,
  EnrollmentMode,
  LessonStatus,
  PaymentMethod,
} from "@/lib/db/schema";

export const metadata = { title: "Student" };

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  payid: "PayID",
  transfer: "Transfer",
  other: "Other",
};

const STATUS_LABEL: Record<LessonStatus, string> = {
  scheduled: "Scheduled",
  attended: "Attended",
  late: "Late",
  absent: "Absent",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
};

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string | null;
  year_level: string | null;
  active: boolean;
  billing_cycle: BillingCycle;
  billing_anchor: string | null;
  created_at: string;
}
interface LessonRow {
  date: string;
  status: LessonStatus;
  duration_minutes: number;
  amount_cents: number;
  enrollment: { subject: { name: string } | null } | null;
}
interface EnrollmentQueryRow {
  id: string;
  mode: EnrollmentMode;
  hourly_rate_cents: number;
  session_minutes: number;
  currency: string;
  active: boolean;
  subject: { name: string } | null;
}
interface ScheduleQueryRow {
  id: string;
  enrollment_id: string;
  weekday: number;
  start_time: string;
  duration_override: number | null;
  effective_to: string | null;
  active: boolean;
}
interface PaymentRow {
  id: string;
  paid_on: string;
  method: PaymentMethod;
  amount_cents: number;
}
interface AssignmentQueryRow {
  id: string;
  title: string;
  status: AssignmentStatus;
  due_date: string | null;
  order_index: number;
  subject: { name: string } | null;
}
interface WorksheetOptionRow {
  id: string;
  title: string;
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const result = await resolveActiveTenant();
  if (result.status !== "ok") {
    redirect(result.status === "none" ? "/login" : "/tenant-select");
  }
  const isStaff = ["owner", "admin", "tutor"].includes(result.tenant.role);
  const { id } = await params;

  const supabase = await createClient();
  const { data: studentData } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, year_level, active, billing_cycle, billing_anchor, created_at",
    )
    .eq("id", id)
    .single();
  if (!studentData) notFound();
  const student = studentData as unknown as StudentRow;

  const [
    { data: lessonData },
    { data: paymentData },
    { data: enrollmentData },
    { data: subjectData },
    { data: assignmentData },
    { data: worksheetOptionData },
  ] = await Promise.all([
    supabase
      .from("lessons")
      .select(
        "date, status, duration_minutes, amount_cents, enrollment:enrollments(subject:subjects(name))",
      )
      .eq("student_id", id)
      .order("date", { ascending: false }),
    supabase
      .from("payments")
      .select("id, paid_on, method, amount_cents")
      .eq("student_id", id)
      .order("paid_on", { ascending: false }),
    supabase
      .from("enrollments")
      .select(
        "id, mode, hourly_rate_cents, session_minutes, currency, active, subject:subjects(name)",
      )
      .eq("student_id", id)
      .order("created_at", { ascending: true }),
    isStaff
      ? supabase
          .from("subjects")
          .select("id, name")
          .eq("tenant_id", result.tenant.tenantId)
          .eq("active", true)
          .order("name", { ascending: true })
      : Promise.resolve({ data: [] as SubjectOption[] }),
    supabase
      .from("assignments")
      .select("id, title, status, due_date, order_index, subject:subjects(name)")
      .eq("student_id", id)
      .order("order_index", { ascending: true }),
    isStaff
      ? supabase
          .from("worksheets")
          .select("id, title")
          .eq("tenant_id", result.tenant.tenantId)
          .eq("active", true)
          .order("title", { ascending: true })
      : Promise.resolve({ data: [] as WorksheetOptionRow[] }),
  ]);
  const lessons = (lessonData ?? []) as unknown as LessonRow[];
  const payments = (paymentData ?? []) as unknown as PaymentRow[];
  const enrollmentRows = (enrollmentData ?? []) as unknown as EnrollmentQueryRow[];
  const subjects = (subjectData ?? []) as unknown as SubjectOption[];

  // Current weekly slots (Slice B) for this student's enrollments — the recurring
  // pattern the calendar renders from. "Current" = active + not yet end-dated.
  const enrollmentIds = enrollmentRows.map((e) => e.id);
  const { data: scheduleData } = isStaff && enrollmentIds.length
    ? await supabase
        .from("enrollment_schedules")
        .select("id, enrollment_id, weekday, start_time, duration_override, effective_to, active")
        .in("enrollment_id", enrollmentIds)
    : { data: [] as ScheduleQueryRow[] };
  const scheduleRows = (scheduleData ?? []) as unknown as ScheduleQueryRow[];
  const slotsByEnrollment = new Map<string, ScheduleQueryRow[]>();
  for (const s of scheduleRows) {
    if (!s.active || s.effective_to !== null) continue; // current slots only
    const arr = slotsByEnrollment.get(s.enrollment_id) ?? [];
    arr.push(s);
    slotsByEnrollment.set(s.enrollment_id, arr);
  }
  const assignmentRows = (assignmentData ?? []) as unknown as AssignmentQueryRow[];
  const worksheetOptions = (worksheetOptionData ?? []) as unknown as WorksheetOptionRow[];

  const trackerAssignments: TrackerAssignment[] = assignmentRows.map((a) => ({
    id: a.id,
    title: a.title,
    status: a.status,
    subjectName: a.subject?.name ?? null,
    dueDate: a.due_date,
    orderIndex: a.order_index,
  }));
  const trackerWorksheets: TrackerWorksheet[] = worksheetOptions.map((w) => ({
    id: w.id,
    title: w.title,
  }));

  // Running balance (all-time) — what the student currently owes.
  const billed = lessons.reduce((s, l) => s + l.amount_cents, 0);
  const paid = payments.reduce((s, p) => s + p.amount_cents, 0);
  const outstanding = billed - paid;

  // Subjects → hours → total rollup (attended blocks only, all-time).
  const rollup = new Map<string, { minutes: number; cents: number }>();
  for (const l of lessons) {
    if (l.status !== "attended" && l.status !== "late") continue;
    const subject = l.enrollment?.subject?.name ?? "Unassigned";
    const cur = rollup.get(subject) ?? { minutes: 0, cents: 0 };
    cur.minutes += l.duration_minutes;
    cur.cents += l.amount_cents;
    rollup.set(subject, cur);
  }
  const rollupRows = [...rollup.entries()].sort((a, b) => b[1].cents - a[1].cents);

  const today = todaySydney();
  const anchor = student.billing_anchor ?? student.created_at.slice(0, 10);
  const due = nextCollection(student.billing_cycle, anchor, today);

  const fullName = `${student.first_name}${student.last_name ? ` ${student.last_name}` : ""}`;
  const activeCount = enrollmentRows.filter((e) => e.active).length;

  const enrollments: EnrollmentRow[] = enrollmentRows.map((e) => ({
    id: e.id,
    subjectName: e.subject?.name ?? "—",
    mode: e.mode,
    hourlyRateCents: e.hourly_rate_cents,
    sessionMinutes: e.session_minutes,
    currency: e.currency,
    active: e.active,
    schedules: (slotsByEnrollment.get(e.id) ?? [])
      .map((s) => ({
        id: s.id,
        weekday: s.weekday,
        startTime: s.start_time,
        durationOverride: s.duration_override,
      }))
      .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)),
  }));

  return (
    <main className="flex-1 px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/dashboard/students"
          className="text-sm text-brand-plum-mid hover:underline"
        >
          ← Students
        </Link>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl tracking-tight text-brand-plum sm:text-4xl">
              {fullName}
            </h1>
            <p className="mt-1 text-sm text-brand-ink/60">
              {student.year_level ?? "—"} ·{" "}
              {activeCount === 0
                ? "no enrollments"
                : `${activeCount} enrollment${activeCount > 1 ? "s" : ""}`}{" "}
              · {cycleLabel(student.billing_cycle)}
            </p>
          </div>
          <div className="flex gap-2">
            <div className="rounded-xl border border-brand-mist bg-white px-4 py-3 text-right">
              <p className="text-[11px] uppercase tracking-wide text-brand-ink/50">
                Billed
              </p>
              <p className="mt-1 font-display text-lg text-brand-plum">
                {formatMoney(billed)}
              </p>
            </div>
            <div className="rounded-xl border border-brand-mist bg-white px-4 py-3 text-right">
              <p className="text-[11px] uppercase tracking-wide text-brand-ink/50">
                Paid
              </p>
              <p className="mt-1 font-display text-lg text-brand-sage">
                {formatMoney(paid)}
              </p>
            </div>
            <div className="rounded-xl border border-brand-mist bg-white px-4 py-3 text-right">
              <p className="text-[11px] uppercase tracking-wide text-brand-ink/50">
                Outstanding
              </p>
              <p className="mt-1 font-display text-lg text-brand-plum">
                {outstanding <= 0 ? "Settled" : formatMoney(outstanding)}
              </p>
            </div>
          </div>
        </div>
        {outstanding > 0 ? (
          <p className="mt-2 text-xs text-brand-ink/45">
            Collect by {shortDate(due)} ({relativeDay(due, today)})
          </p>
        ) : null}

        {/* Billing settings — staff only */}
        {isStaff ? (
          <BillingSettingsForm
            studentId={student.id}
            defaultYearLevel={student.year_level ?? ""}
            defaultCycle={student.billing_cycle}
            defaultAnchor={anchor}
          />
        ) : null}

        {/* Enrollments — staff only */}
        {isStaff ? (
          <EnrollmentsManager
            studentId={student.id}
            subjects={subjects}
            enrollments={enrollments}
            hasYearLevel={!!student.year_level}
          />
        ) : null}

        {/* Homework pipeline — staff only */}
        {isStaff ? (
          <AssignmentTracker
            studentId={student.id}
            worksheets={trackerWorksheets}
            assignments={trackerAssignments}
          />
        ) : null}

        {/* Subjects → hours → total rollup */}
        {rollupRows.length > 0 ? (
          <div className="mt-8">
            <h2 className="text-sm font-medium text-brand-plum">
              Billed by subject
            </h2>
            <div className="mt-3 overflow-hidden rounded-2xl border border-brand-mist bg-white">
              <ul className="divide-y divide-brand-mist">
                {rollupRows.map(([subject, v]) => (
                  <li
                    key={subject}
                    className="flex items-center justify-between px-5 py-3 text-sm"
                  >
                    <span className="text-brand-ink/75">{subject}</span>
                    <span className="flex items-center gap-4">
                      <span className="text-xs text-brand-ink/55">
                        {formatDuration(v.minutes)}
                      </span>
                      <span className="w-16 text-right font-medium text-brand-plum">
                        {formatMoney(v.cents)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        <h2 className="mt-10 text-sm font-medium text-brand-plum">
          Attendance history
        </h2>
        {lessons.length === 0 ? (
          <p className="mt-3 text-sm text-brand-ink/60">
            No lessons recorded yet.
          </p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-2xl border border-brand-mist bg-white">
            <ul className="divide-y divide-brand-mist">
              {lessons.map((l, i) => (
                <li
                  key={`${l.date}-${i}`}
                  className="flex items-center justify-between px-5 py-3 text-sm"
                >
                  <span className="text-brand-ink/75">
                    {prettyDate(l.date)}
                    <span className="ml-2 text-xs text-brand-ink/45">
                      {l.enrollment?.subject?.name ?? "—"} ·{" "}
                      {formatDuration(l.duration_minutes)}
                    </span>
                  </span>
                  <span className="flex items-center gap-4">
                    <span
                      className={
                        l.status === "attended" || l.status === "late"
                          ? "text-brand-plum"
                          : "text-brand-ink/45"
                      }
                    >
                      {STATUS_LABEL[l.status]}
                    </span>
                    <span className="w-16 text-right font-medium text-brand-plum">
                      {formatMoney(l.amount_cents)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <h2 className="mt-10 text-sm font-medium text-brand-plum">Payments</h2>
        {payments.length === 0 ? (
          <p className="mt-3 text-sm text-brand-ink/60">
            No payments recorded yet. Log them from the Billing page.
          </p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-2xl border border-brand-mist bg-white">
            <ul className="divide-y divide-brand-mist">
              {payments.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between px-5 py-3 text-sm"
                >
                  <span className="text-brand-ink/75">
                    {prettyDate(p.paid_on)}
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="rounded-full bg-brand-sage/15 px-3 py-1 text-xs font-medium text-brand-plum">
                      {METHOD_LABEL[p.method]}
                    </span>
                    <span className="w-16 text-right font-medium text-brand-sage">
                      {formatMoney(p.amount_cents)}
                    </span>
                    {isStaff ? <UndoPaymentButton paymentId={p.id} /> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isStaff ? (
          <StudentAdmin
            studentId={student.id}
            studentName={fullName}
            active={student.active}
          />
        ) : null}
      </div>
    </main>
  );
}
