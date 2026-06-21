"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { todaySydney } from "@/lib/billing";
import type { PaymentMethod } from "@/lib/db/schema";

const VALID: PaymentMethod[] = ["cash", "card", "payid", "transfer", "other"];

export async function recordPayment(
  studentId: string,
  amountCents: number,
  method: PaymentMethod,
): Promise<{ ok: boolean; paymentId: string | null }> {
  if (
    !studentId ||
    !Number.isFinite(amountCents) ||
    amountCents <= 0 ||
    !VALID.includes(method)
  ) {
    return { ok: false, paymentId: null };
  }
  const supabase = await createClient();
  const { data: student } = await supabase
    .from("students")
    .select("tenant_id")
    .eq("id", studentId)
    .single();
  if (!student) return { ok: false, paymentId: null };

  const { data, error } = await supabase
    .from("payments")
    .insert({
      tenant_id: (student as unknown as { tenant_id: string }).tenant_id,
      student_id: studentId,
      amount_cents: amountCents,
      method,
      paid_on: todaySydney(),
    })
    .select("id")
    .single();

  revalidatePath("/dashboard", "layout");
  return {
    ok: !error,
    paymentId: (data as unknown as { id: string } | null)?.id ?? null,
  };
}

export async function deletePayment(
  paymentId: string,
): Promise<{ ok: boolean }> {
  if (!paymentId) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("payments").delete().eq("id", paymentId);
  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}
