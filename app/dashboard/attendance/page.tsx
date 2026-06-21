import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import { todaySydney } from "@/lib/billing";
import { DatePicker } from "@/components/dashboard/date-picker";
import {
  AttendanceRegister,
  type RegisterStudent,
} from "@/components/dashboard/attendance-register";
import type { LessonStatus } from "@/lib/db/schema";

export const metadata = { title: "Attendance" };

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string | null;
  rate: { amount_cents: number } | null;
}
interface LessonRow {
  student_id: string;
  status: LessonStatus;
  amount_cents: number;
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
  const [{ data: studentData }, { data: lessonData }] = await Promise.all([
    supabase
      .from("students")
      .select("id, first_name, last_name, rate:rate_cards(amount_cents)")
      .eq("tenant_id", tenant.tenantId)
      .eq("active", true)
      .order("first_name", { ascending: true }),
    supabase
      .from("lessons")
      .select("student_id, status, amount_cents")
      .eq("tenant_id", tenant.tenantId)
      .eq("date", date),
  ]);

  const studentRows = (studentData ?? []) as unknown as StudentRow[];
  const lessons = (lessonData ?? []) as unknown as LessonRow[];
  const byStudent = new Map(lessons.map((l) => [l.student_id, l]));

  const students: RegisterStudent[] = studentRows.map((s) => {
    const lesson = byStudent.get(s.id);
    return {
      id: s.id,
      name: `${s.first_name}${s.last_name ? ` ${s.last_name}` : ""}`,
      rateCents: s.rate?.amount_cents ?? 0,
      status: lesson?.status ?? null,
      postedCents: lesson?.amount_cents ?? null,
    };
  });

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
          present and late charge the full rate, absent and cancelled charge
          nothing.
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

        <AttendanceRegister date={date} students={students} />
      </div>
    </main>
  );
}
