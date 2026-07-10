import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import {
  PricingManager,
  type PriceItem,
  type SubjectItem,
} from "@/components/dashboard/pricing-manager";
import type { EnrollmentMode } from "@/lib/db/schema";

export const metadata = { title: "Pricing" };

interface SubjectQueryRow {
  id: string;
  name: string;
  active: boolean;
}
interface PriceQueryRow {
  id: string;
  year_level: string;
  subject_id: string;
  mode: EnrollmentMode;
  hourly_rate_cents: number;
  default_session_minutes: number;
  currency: string;
  active: boolean;
  subject: { name: string } | null;
}

export default async function PricingPage() {
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
            Pricing
          </h1>
          <p className="mt-3 text-sm text-brand-ink/65">
            The price list is for tutors and admins.
          </p>
        </div>
      </main>
    );
  }

  const supabase = await createClient();
  const [{ data: subjectData }, { data: priceData }] = await Promise.all([
    supabase
      .from("subjects")
      .select("id, name, active")
      .eq("tenant_id", tenant.tenantId)
      .order("name", { ascending: true }),
    supabase
      .from("price_list_items")
      .select(
        "id, year_level, subject_id, mode, hourly_rate_cents, default_session_minutes, currency, active, subject:subjects(name)",
      )
      .eq("tenant_id", tenant.tenantId)
      .order("year_level", { ascending: true }),
  ]);

  const subjects: SubjectItem[] = (
    (subjectData ?? []) as unknown as SubjectQueryRow[]
  ).map((s) => ({ id: s.id, name: s.name, active: s.active }));

  const prices: PriceItem[] = (
    (priceData ?? []) as unknown as PriceQueryRow[]
  ).map((p) => ({
    id: p.id,
    yearLevel: p.year_level,
    subjectId: p.subject_id,
    subjectName: p.subject?.name ?? "—",
    mode: p.mode,
    hourlyRateCents: p.hourly_rate_cents,
    defaultSessionMinutes: p.default_session_minutes,
    currency: p.currency,
    active: p.active,
  }));

  return (
    <main className="flex-1 px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-plum-mid">
          {tenant.displayName}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-brand-plum sm:text-4xl">
          Pricing
        </h1>
        <p className="mt-2 text-sm text-brand-ink/65">
          Your subjects and the rate for each year level, subject and mode.
          Attendance bills attended hours × the hourly rate.
        </p>

        <PricingManager subjects={subjects} prices={prices} />
      </div>
    </main>
  );
}
