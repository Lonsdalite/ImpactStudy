import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import {
  cycleLabel,
  formatMoney,
  nextCollection,
  relativeDay,
  shortDate,
  todaySydney,
} from "@/lib/billing";
import { RecordPaymentForm } from "@/components/dashboard/record-payment-form";
import type { BillingCycle, LessonStatus } from "@/lib/db/schema";

export const metadata = { title: "Billing" };

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string | null;
  billing_cycle: BillingCycle;
  billing_anchor: string | null;
  created_at: string;
}
interface LessonRow {
  student_id: string;
  status: LessonStatus;
  amount_cents: number;
}
interface PaymentRow {
  student_id: string;
  amount_cents: number;
}

export default async function BillingPage() {
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
            Billing
          </h1>
          <p className="mt-3 text-sm text-brand-ink/65">
            Billing is for tutors and admins.
          </p>
        </div>
      </main>
    );
  }

  const today = todaySydney();
  const supabase = await createClient();
  const [{ data: studentData }, { data: lessonData }, { data: payData }] =
    await Promise.all([
      supabase
        .from("students")
        .select(
          "id, first_name, last_name, billing_cycle, billing_anchor, created_at",
        )
        .eq("tenant_id", tenant.tenantId)
        .eq("active", true),
      supabase
        .from("lessons")
        .select("student_id, status, amount_cents")
        .eq("tenant_id", tenant.tenantId),
      supabase
        .from("payments")
        .select("student_id, amount_cents")
        .eq("tenant_id", tenant.tenantId),
    ]);

  const students = (studentData ?? []) as unknown as StudentRow[];
  const lessons = (lessonData ?? []) as unknown as LessonRow[];
  const payments = (payData ?? []) as unknown as PaymentRow[];

  const billedBy = new Map<string, number>();
  for (const l of lessons) {
    billedBy.set(l.student_id, (billedBy.get(l.student_id) ?? 0) + l.amount_cents);
  }
  const paidBy = new Map<string, number>();
  for (const p of payments) {
    paidBy.set(p.student_id, (paidBy.get(p.student_id) ?? 0) + p.amount_cents);
  }

  const rows = students
    .map((s) => {
      const anchor = s.billing_anchor ?? s.created_at.slice(0, 10);
      const due = nextCollection(s.billing_cycle, anchor, today);
      const billed = billedBy.get(s.id) ?? 0;
      const paid = paidBy.get(s.id) ?? 0;
      return {
        id: s.id,
        name: `${s.first_name}${s.last_name ? ` ${s.last_name}` : ""}`,
        cycle: s.billing_cycle,
        due,
        billed,
        paid,
        outstanding: billed - paid,
      };
    })
    .sort((a, b) => a.due.localeCompare(b.due));

  const totalOutstanding = rows.reduce((s, r) => s + Math.max(0, r.outstanding), 0);
  const owingCount = rows.filter((r) => r.outstanding > 0).length;

  return (
    <main className="flex-1 px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-plum-mid">
          {tenant.displayName}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-brand-plum sm:text-4xl">
          Billing
        </h1>
        <p className="mt-2 text-sm text-brand-ink/65">
          Each student on their own cycle, sorted by who&apos;s due next. The app
          remembers the schedule so you don&apos;t have to.
        </p>

        <div className="mt-6 flex gap-3">
          <div className="flex-1 rounded-2xl border border-brand-mist bg-white p-5">
            <p className="text-xs uppercase tracking-wide text-brand-ink/50">
              Total outstanding
            </p>
            <p className="mt-1 font-display text-2xl text-brand-plum">
              {formatMoney(totalOutstanding)}
            </p>
          </div>
          <div className="flex-1 rounded-2xl border border-brand-mist bg-white p-5">
            <p className="text-xs uppercase tracking-wide text-brand-ink/50">
              Students owing
            </p>
            <p className="mt-1 font-display text-2xl text-brand-plum">
              {owingCount}
            </p>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="mt-8 text-sm text-brand-ink/60">No students yet.</p>
        ) : (
          <div className="mt-5 flex flex-col gap-3">
            {rows.map((r) => {
              const settled = r.outstanding <= 0;
              return (
                <div
                  key={r.id}
                  className="rounded-2xl border border-brand-mist bg-white p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-brand-plum">{r.name}</p>
                      <p className="mt-0.5 text-xs text-brand-ink/55">
                        {cycleLabel(r.cycle)} · billed {formatMoney(r.billed)} ·
                        paid {formatMoney(r.paid)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={
                          "font-display text-xl " +
                          (settled ? "text-brand-sage" : "text-brand-plum")
                        }
                      >
                        {settled ? "Settled" : formatMoney(r.outstanding)}
                      </p>
                      {settled ? null : (
                        <p className="text-xs text-brand-ink/55">
                          collect by {shortDate(r.due)} ({relativeDay(r.due, today)})
                        </p>
                      )}
                    </div>
                  </div>

                  <RecordPaymentForm
                    studentId={r.id}
                    studentName={r.name}
                    defaultAmountCents={Math.max(0, r.outstanding)}
                  />
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-3 px-1 text-xs text-brand-ink/50">
          Set each student&apos;s rate and cycle on their record. Stripe / PayID
          payment links are coming soon.
        </p>
      </div>
    </main>
  );
}
