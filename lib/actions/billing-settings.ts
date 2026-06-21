"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BillingCycle } from "@/lib/db/schema";

const VALID: BillingCycle[] = ["weekly", "fortnightly", "monthly"];

/**
 * Set a student's rate (entered in dollars → find-or-create a rate card),
 * billing cycle, and anchor (start) date.
 */
export async function updateBilling(
  studentId: string,
  rateDollars: number,
  cycle: BillingCycle,
  anchor: string,
): Promise<{ ok: boolean }> {
  if (!studentId || !VALID.includes(cycle)) return { ok: false };
  const supabase = await createClient();

  const { data: s } = await supabase
    .from("students")
    .select("tenant_id")
    .eq("id", studentId)
    .single();
  if (!s) return { ok: false };
  const tenantId = (s as unknown as { tenant_id: string }).tenant_id;

  const update: Record<string, unknown> = {
    billing_cycle: cycle,
    billing_anchor: anchor || null,
  };

  if (Number.isFinite(rateDollars) && rateDollars > 0) {
    const amountCents = Math.round(rateDollars * 100);
    const { data: existing } = await supabase
      .from("rate_cards")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("amount_cents", amountCents)
      .limit(1);
    let rateCardId =
      (existing as unknown as { id: string }[] | null)?.[0]?.id ?? null;
    if (!rateCardId) {
      const { data: created } = await supabase
        .from("rate_cards")
        .insert({
          tenant_id: tenantId,
          name: `$${(amountCents / 100).toFixed(0)} / lesson`,
          amount_cents: amountCents,
        })
        .select("id")
        .single();
      rateCardId = (created as unknown as { id: string } | null)?.id ?? null;
    }
    if (rateCardId) update.default_rate_card_id = rateCardId;
  }

  const { error } = await supabase
    .from("students")
    .update(update)
    .eq("id", studentId);

  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}
