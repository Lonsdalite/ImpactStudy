"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import type { BillingCycle } from "@/lib/db/schema";

type SB = Awaited<ReturnType<typeof createClient>>;

async function findOrCreateRateCard(
  supabase: SB,
  tenantId: string,
  amountCents: number,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("rate_cards")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("amount_cents", amountCents)
    .limit(1);
  const found = (existing as unknown as { id: string }[] | null)?.[0]?.id;
  if (found) return found;
  const { data: created } = await supabase
    .from("rate_cards")
    .insert({
      tenant_id: tenantId,
      name: `$${(amountCents / 100).toFixed(0)} / lesson`,
      amount_cents: amountCents,
    })
    .select("id")
    .single();
  return (created as unknown as { id: string } | null)?.id ?? null;
}

async function requireStaff() {
  const res = await resolveActiveTenant();
  if (res.status !== "ok") return null;
  if (!["owner", "admin", "tutor"].includes(res.tenant.role)) return null;
  return res.tenant;
}

export async function createStudent(input: {
  firstName: string;
  lastName: string;
  yearLevel: string;
  rateDollars: number;
  cycle: BillingCycle;
  anchor: string;
}): Promise<{ ok: boolean; studentId: string | null }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, studentId: null };

  const firstName = input.firstName?.trim();
  if (!firstName) return { ok: false, studentId: null };

  const cycle: BillingCycle = (
    ["weekly", "fortnightly", "monthly"] as BillingCycle[]
  ).includes(input.cycle)
    ? input.cycle
    : "monthly";

  const supabase = await createClient();
  let rateCardId: string | null = null;
  if (Number.isFinite(input.rateDollars) && input.rateDollars > 0) {
    rateCardId = await findOrCreateRateCard(
      supabase,
      tenant.tenantId,
      Math.round(input.rateDollars * 100),
    );
  }

  const { data, error } = await supabase
    .from("students")
    .insert({
      tenant_id: tenant.tenantId,
      first_name: firstName,
      last_name: input.lastName?.trim() || null,
      year_level: input.yearLevel?.trim() || null,
      default_rate_card_id: rateCardId,
      billing_cycle: cycle,
      billing_anchor: input.anchor || null,
      active: true,
    })
    .select("id")
    .single();

  revalidatePath("/dashboard", "layout");
  return {
    ok: !error,
    studentId: (data as unknown as { id: string } | null)?.id ?? null,
  };
}

/** Archive (active=false) or reactivate a student. History is preserved. */
export async function setStudentActive(
  studentId: string,
  active: boolean,
): Promise<{ ok: boolean }> {
  if (!studentId) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from("students")
    .update({ active })
    .eq("id", studentId);
  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}

/** Permanent delete — cascades lessons + payments. For genuine mistakes only. */
export async function deleteStudent(
  studentId: string,
): Promise<{ ok: boolean }> {
  if (!studentId) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from("students")
    .delete()
    .eq("id", studentId);
  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}
