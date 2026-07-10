import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import { todaySydney } from "@/lib/billing";
import { DatePicker } from "@/components/dashboard/date-picker";
import {
  AttendanceRegister,
  type RegisterEnrollment,
  type RegisterGuard,
} from "@/components/dashboard/attendance-register";
import type { EnrollmentMode, LessonStatus } from "@/lib/db/schema";

export const metadata = { title: "Attendance" };

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string | null;
}
interface EnrollmentRow {
  id: string;
  student_id: string;
  mode: EnrollmentMode;
  hourly_rate_cents: number;
  session_minutes: number;
  currency: string;
  student: { first_name: string; last_name: string | null; active: boolean } | null;
  subject: { name: string } | null;
}
interface LessonRow {
  id: string;
  enrollment_id: string | null;
  status: LessonStatus;
  duration_minutes: number;
  amount_cents: number;
  note: string | null;
  created_at: string;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const result = await resolveActiveTenant();
  if (result.status !== "ok") {
    redirect(result.status === "none" ? "/login" : "/tenant-select");
  }
  const { tenant } = result;
  const isStaff = ["owner", "admin", "tutor"].includes(tenant.role);
  if (!isStaff) {
    return (
      <main className="flex-1 px-6 py-10 md:px-10">
        <div className="mx-auto max-w-4xl">
          <h1 className="font-display text-3xl tracking-tight text-brand-plum">
            Attendance
          </h1>
          <p className="mt-3 text-sm text-brand-ink/65">
            The attendance register is for tutors and admins.
          </p>
        </div>
      </main>
    );
  }

  const params = await searchParams;
  const date = params.date ?? todaySydney();

  const supabase = await createClient();
  const [{ data: studentData }, { data: enrollmentData }, { data: lessonData }] =
    await Promise.all([
      supabase
        .from("students")
        .select("id, first_name, last_name")
        .eq("tenant_id", tenant.tenantId)
        .eq("active", true)
        .order("first_name", { ascending: true }),
      supabase
        .from("enrollments")
        .select(
          "id, student_id, mode, hourly_rate_cents, session_minutes, currency, student:students(first_name, last_name, active), subject:subjects(name)",
        )
        .eq("tenant_id", tenant.tenantId)
        .eq("active", true),
      supabase
        .from("lessons")
        .select(
          "id, enrollment_id, status, duration_minutes, amount_cents, note, created_at",
        )
        .eq("tenant_id", tenant.tenantId)
        .eq("date", date),
    ]);

  const students = (studentData ?? []) as unknown as StudentRow[];
  const enrollmentRows = (enrollmentData ?? []) as unknown as EnrollmentRow[];
  const lessons = (lessonData ?? []) as unknown as LessonRow[];

  // Group the day's lessons by enrollment, oldest first (canonical = first).
  const byEnrollment = new Map<string, LessonRow[]>();
  for (const l of lessons) {
    if (!l.enrollment_id) continue;
    const arr = byEnrollment.get(l.enrollment_id) ?? [];
    arr.push(l);
    byEnrollment.set(l.enrollment_id, arr);
  }
  for (const arr of byEnrollment.values()) {
    arr.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  }

  const activeEnrollments = enrollmentRows.filter(
    (e) => e.student?.active !== false,
  );

  const enrollments: RegisterEnrollment[] = activeEnrollments
    .map((e) => {
      const rows = byEnrollment.get(e.id) ?? [];
      const [canonical, ...extras] = rows;
      const student = e.student;
      const name = student
        ? `${student.first_name}${student.last_name ? ` ${student.last_name}` : ""}`
        : "—";
      return {
        enrollmentId: e.id,
        studentId: e.student_id,
        studentName: name,
        subjectName: e.subject?.name ?? "—",
        mode: e.mode,
        hourlyRateCents: e.hourly_rate_cents,
        sessionMinutes: e.session_minutes,
        currency: e.currency,
        canonical: canonical
          ? {
              lessonId: canonical.id,
              status: canonical.status,
              amountCents: canonical.amount_cents,
              durationMinutes: canonical.duration_minutes,
              note: canonical.note,
            }
          : null,
        extras: extras.map((x) => ({
          lessonId: x.id,
          status: x.status,
          amountCents: x.amount_cents,
          durationMinutes: x.duration_minutes,
        })),
      };
    })
    .sort((a, b) =>
      a.studentName === b.studentName
        ? a.subjectName.localeCompare(b.subjectName)
        : a.studentName.localeCompare(b.studentName),
    );

  // Guard rows: active students with no active enrollment ("add an enrollment").
  const enrolledStudentIds = new Set(activeEnrollments.map((e) => e.student_id));
  const guards: RegisterGuard[] = students
    .filter((s) => !enrolledStudentIds.has(s.id))
    .map((s) => ({
      studentId: s.id,
      studentName: `${s.first_name}${s.last_name ? ` ${s.last_name}` : ""}`,
    }));

  return (
    <main className="flex-1 px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-plum-mid">
          {tenant.displayName}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-brand-plum sm:text-4xl">
          Attendance
        </h1>
        <p className="mt-2 text-sm text-brand-ink/65">
          Mark all present, then fix the exceptions. Fees post automatically —
          attended hours × the hourly rate; absent and cancelled charge nothing.
        </p>

        {/* Date nav */}
        <div className="mt-6 flex items-center justify-between rounded-xl border border-brand-mist bg-white px-4 py-3">
          <Link
            href={`/dashboard/attendance?date=${addDays(date, -1)}`}
            className="rounded-lg px-3 py-1.5 text-sm text-brand-plum-mid hover:bg-brand-plum/[0.05]"
          >
            ← Prev
          </Link>
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-sm font-medium text-brand-plum">
              {prettyDate(date)}
            </span>
            <div className="flex items-center gap-2">
              <DatePicker date={date} basePath="/dashboard/attendance" />
              {date !== todaySydney() ? (
                <Link
                  href="/dashboard/attendance"
                  className="text-xs text-brand-plum-mid hover:underline"
                >
                  Today
                </Link>
              ) : null}
            </div>
          </div>
          <Link
            href={`/dashboard/attendance?date=${addDays(date, 1)}`}
            className="rounded-lg px-3 py-1.5 text-sm text-brand-plum-mid hover:bg-brand-plum/[0.05]"
          >
            Next →
          </Link>
        </div>

        <AttendanceRegister
          date={date}
          enrollments={enrollments}
          guards={guards}
        />
      </div>
    </main>
  );
}
