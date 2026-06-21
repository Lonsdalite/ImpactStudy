import { redirect, notFound } from "next/navigation";
import Link from "next/link";
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
import { BillingSettingsForm } from "@/components/dashboard/billing-settings-form";
import { UndoPaymentButton } from "@/components/dashboard/undo-payment-button";
import { StudentAdmin } from "@/components/dashboard/student-admin";
import type {
  BillingCycle,
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
  present: "Present",
  late: "Late",
  absent: "Absent",
  cancelled: "Cancelled",
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
  rate: { amount_cents: number; currency: string } | null;
}
interface LessonRow {
  date: string;
  status: LessonStatus;
  amount_cents: number;
}
interface PaymentRow {
  id: string;
  paid_on: string;
  method: PaymentMethod;
  amount_cents: number;
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
      "id, first_name, last_name, year_level, active, billing_cycle, billing_anchor, created_at, rate:rate_cards(amount_cents, currency)",
    )
    .eq("id", id)
    .single();
  if (!studentData) notFound();
  const student = studentData as unknown as StudentRow;

  const [{ data: lessonData }, { data: paymentData }] = await Promise.all([
    supabase
      .from("lessons")
      .select("date, status, amount_cents")
      .eq("student_id", id)
      .order("date", { ascending: false }),
    supabase
      .from("payments")
      .select("id, paid_on, method, amount_cents")
      .eq("student_id", id)
      .order("paid_on", { ascending: false }),
  ]);
  const lessons = (lessonData ?? []) as unknown as LessonRow[];
  const payments = (paymentData ?? []) as unknown as PaymentRow[];

  // Running balance (all-time) — what the student currently owes.
  const billed = lessons.reduce((s, l) => s + l.amount_cents, 0);
  const paid = payments.reduce((s, p) => s + p.amount_cents, 0);
  const outstanding = billed - paid;

  const today = todaySydney();
  const anchor = student.billing_anchor ?? student.created_at.slice(0, 10);
  const due = nextCollection(student.billing_cycle, anchor, today);

  const fullName = `${student.first_name}${student.last_name ? ` ${student.last_name}` : ""}`;
  const rateDollars = student.rate
    ? (student.rate.amount_cents / 100).toFixed(0)
    : "";

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
              {student.year_level ?? "—"} · Rate{" "}
              {student.rate ? formatMoney(student.rate.amount_cents) : "not set"}{" "}
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
            defaultRateDollars={rateDollars}
            defaultCycle={student.billing_cycle}
            defaultAnchor={anchor}
          />
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
              {lessons.map((l) => (
                <li
                  key={l.date}
                  className="flex items-center justify-between px-5 py-3 text-sm"
                >
                  <span className="text-brand-ink/75">{prettyDate(l.date)}</span>
                  <span className="flex items-center gap-4">
                    <span
                      className={
                        l.status === "present" || l.status === "late"
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
