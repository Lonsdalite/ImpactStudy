import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import { formatMoney, monthBounds, monthLabel, todaySydney } from "@/lib/billing";

export const metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const result = await resolveActiveTenant();
  if (result.status !== "ok") {
    redirect(result.status === "none" ? "/login" : "/tenant-select");
  }
  const { tenant } = result;

  // Live count via the RLS path — owner/admin/tutor see the whole tenant; a
  // parent sees only their own children. This is the tenant-isolation proof.
  const supabase = await createClient();
  const { count } = await supabase
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.tenantId);

  const studentCount = count ?? 0;
  const isParent = tenant.role === "parent" || tenant.role === "student";

  // Staff: total billed so far this month (attendance-driven).
  const month = todaySydney().slice(0, 7);
  let monthBilledCents = 0;
  if (!isParent) {
    const { start, end } = monthBounds(`${month}-01`);
    const { data: ls } = await supabase
      .from("lessons")
      .select("amount_cents")
      .eq("tenant_id", tenant.tenantId)
      .gte("date", start)
      .lte("date", end);
    monthBilledCents = ((ls ?? []) as { amount_cents: number }[]).reduce(
      (s, l) => s + (l.amount_cents ?? 0),
      0,
    );
  }

  return (
    <main className="flex-1 px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-plum-mid">
          {tenant.displayName}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-brand-plum sm:text-4xl">
          Overview
        </h1>
        <p className="mt-2 text-sm text-brand-ink/65">
          {isParent
            ? "Everything for your child, in one place."
            : "Your practice at a glance."}
        </p>

        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          <Link
            href="/dashboard/students"
            className="flex flex-col rounded-2xl border border-brand-mist bg-white p-6 transition-colors hover:border-brand-plum/30"
          >
            <span className="text-sm font-medium text-brand-plum">
              {isParent ? "Children" : "Students"}
            </span>
            <span className="mt-3 font-display text-4xl text-brand-plum">
              {studentCount}
            </span>
            <span className="mt-1 text-xs text-brand-ink/55">
              {studentCount === 1 ? "active record" : "active records"}
            </span>
          </Link>

          {isParent ? (
            <div className="flex flex-col rounded-2xl border border-brand-mist bg-white p-6">
              <span className="text-sm font-medium text-brand-plum">
                Practice
              </span>
              <span className="mt-3 font-display text-4xl text-brand-ink/25">
                —
              </span>
              <span className="mt-1 text-xs text-brand-ink/55">
                Adaptive daily practice · coming soon
              </span>
            </div>
          ) : (
            <Link
              href="/dashboard/billing"
              className="flex flex-col rounded-2xl border border-brand-mist bg-white p-6 transition-colors hover:border-brand-plum/30"
            >
              <span className="text-sm font-medium text-brand-plum">
                Billed this month
              </span>
              <span className="mt-3 font-display text-4xl text-brand-plum">
                {formatMoney(monthBilledCents)}
              </span>
              <span className="mt-1 text-xs text-brand-ink/55">
                {monthLabel(month)} · from attendance
              </span>
            </Link>
          )}

          <div className="flex flex-col rounded-2xl border border-brand-mist bg-white p-6">
            <span className="text-sm font-medium text-brand-plum">Reports</span>
            <span className="mt-3 font-display text-4xl text-brand-ink/25">—</span>
            <span className="mt-1 text-xs text-brand-ink/55">
              Parent heartbeat · coming soon
            </span>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-brand-plum/15 bg-brand-plum/[0.03] p-6">
          <h2 className="text-sm font-medium text-brand-plum">What&apos;s next</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-brand-ink/70">
            Attendance and billing are live. Coming next: adaptive daily practice
            for your students, and automatic progress reports for parents — all in
            your voice.
          </p>
        </div>
      </div>
    </main>
  );
}
