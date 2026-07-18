import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import { EmptyState } from "@/components/dashboard/empty-state";
import { AddStudentForm } from "@/components/dashboard/add-student-form";
import {
  StudentList,
  type StudentListRow,
} from "@/components/dashboard/student-list";
import { formatMoney, nextCollection, shortDate, todaySydney } from "@/lib/billing";
import type { BillingCycle } from "@/lib/db/schema";

export const metadata = { title: "Students" };

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

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const result = await resolveActiveTenant();
  if (result.status !== "ok") {
    redirect(result.status === "none" ? "/login" : "/tenant-select");
  }
  const { tenant } = result;
  const isParent = tenant.role === "parent" || tenant.role === "student";
  const isStaff = !isParent;
  const params = await searchParams;
  const showArchived = isStaff && params.view === "archived";
  const today = todaySydney();

  const supabase = await createClient();
  const { data } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, year_level, active, billing_cycle, billing_anchor, created_at",
    )
    .eq("tenant_id", tenant.tenantId)
    .eq("active", !showArchived)
    .order("first_name", { ascending: true });
  const students = (data ?? []) as unknown as StudentRow[];

  // Parents: compute each child's outstanding balance + next-collection date.
  const balance = new Map<string, { outstanding: number; due: string }>();
  if (isParent && students.length > 0) {
    const ids = students.map((s) => s.id);
    // parent_lessons = the column-safe parent view (the base lessons table is
    // staff-only in RLS since Slice B.5).
    const [{ data: lessonData }, { data: payData }] = await Promise.all([
      supabase.from("parent_lessons").select("student_id, amount_cents").in("student_id", ids),
      supabase.from("payments").select("student_id, amount_cents").in("student_id", ids),
    ]);
    const billed = new Map<string, number>();
    for (const l of (lessonData ?? []) as { student_id: string; amount_cents: number }[]) {
      billed.set(l.student_id, (billed.get(l.student_id) ?? 0) + l.amount_cents);
    }
    const paid = new Map<string, number>();
    for (const p of (payData ?? []) as { student_id: string; amount_cents: number }[]) {
      paid.set(p.student_id, (paid.get(p.student_id) ?? 0) + p.amount_cents);
    }
    for (const s of students) {
      const anchor = s.billing_anchor ?? s.created_at.slice(0, 10);
      balance.set(s.id, {
        outstanding: (billed.get(s.id) ?? 0) - (paid.get(s.id) ?? 0),
        due: nextCollection(s.billing_cycle, anchor, today),
      });
    }
  }

  // Pre-format each row on the server (balance strings use the billing utils)
  // so the client list stays a dumb, filterable presenter.
  const rows: StudentListRow[] = students.map((s) => {
    const bal = balance.get(s.id);
    const balanceLabel =
      isParent && bal
        ? bal.outstanding > 0
          ? `${formatMoney(bal.outstanding)} · due ${shortDate(bal.due)}`
          : "Settled"
        : null;
    return {
      id: s.id,
      name: `${s.first_name}${s.last_name ? ` ${s.last_name}` : ""}`,
      yearLevel: s.year_level ?? "—",
      balanceLabel,
      settled: isParent && bal ? bal.outstanding <= 0 : false,
    };
  });

  // Show the instant filter for staff (a parent has a couple of children) as
  // soon as there's more than one student to filter. A single slim field is not
  // "busy"; keeping the floor at 2 just avoids a pointless search over one row.
  const showSearch = isStaff && rows.length >= 2;

  return (
    <main className="flex-1 px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-plum-mid">
          {tenant.displayName}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-3xl tracking-tight text-brand-plum sm:text-4xl">
            {isParent ? "Children" : showArchived ? "Archived students" : "Students"}
          </h1>
          {isStaff && !showArchived ? <AddStudentForm today={today} /> : null}
        </div>
        <p className="mt-2 text-sm text-brand-ink/65">
          {isParent
            ? "Your children, their attendance, and what's due."
            : showArchived
              ? "Past students. Their history is kept; reactivate any time."
              : "Everyone in your practice."}
        </p>

        {students.length === 0 ? (
          <div className="mt-10">
            <EmptyState
              title={
                isParent
                  ? "No children linked yet"
                  : showArchived
                    ? "No archived students"
                    : "No students yet"
              }
              body={
                isParent
                  ? "Once your tutor links a child to your account, they'll appear here."
                  : showArchived
                    ? "Students you archive will appear here."
                    : "Add your first student to start marking attendance."
              }
            />
          </div>
        ) : (
          <StudentList rows={rows} showSearch={showSearch} />
        )}

        {isStaff ? (
          <p className="mt-4 px-1 text-xs text-brand-ink/50">
            {showArchived ? (
              <Link href="/dashboard/students" className="hover:underline">
                ← Back to active students
              </Link>
            ) : (
              <Link
                href="/dashboard/students?view=archived"
                className="hover:underline"
              >
                View archived students
              </Link>
            )}
          </p>
        ) : null}
      </div>
    </main>
  );
}
