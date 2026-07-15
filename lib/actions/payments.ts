"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import { todaySydney } from "@/lib/billing";
import type { PaymentMethod } from "@/lib/db/schema";

const VALID: PaymentMethod[] = ["cash", "card", "payid", "transfer", "other"];

async function requireStaff(): Promise<{ tenantId: string } | null> {
  const res = await resolveActiveTenant();
  if (res.status !== "ok") return null;
  if (!["owner", "admin", "tutor"].includes(res.tenant.role)) return null;
  return { tenantId: res.tenant.tenantId };
}

export async function recordPayment(
  studentId: string,
  amountCents: number,
  method: PaymentMethod,
): Promise<{ ok: boolean; paymentId: string | null }> {
  const staff = await requireStaff();
  if (
    !staff ||
    !studentId ||
    !Number.isFinite(amountCents) ||
    amountCents <= 0 ||
    !VALID.includes(method)
  ) {
    return { ok: false, paymentId: null };
  }
  const supabase = await createClient();
  // The student must belong to the ACTIVE tenant — never trust a studentId to
  // pick its own tenant (doc 06 §6 in-code tenant scoping).
  const { data: student } = await supabase
    .from("students")
    .select("id")
    .eq("id", studentId)
    .eq("tenant_id", staff.tenantId)
    .single();
  if (!student) return { ok: false, paymentId: null };

  const { data, error } = await supabase
    .from("payments")
    .insert({
      tenant_id: staff.tenantId,
      student_id: studentId,
      amount_cents: Math.round(amountCents),
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
  const staff = await requireStaff();
  if (!staff || !paymentId) return { ok: false };
  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from("payments")
    .delete()
    .eq("id", paymentId)
    .eq("tenant_id", staff.tenantId)
    .select("id");
  revalidatePath("/dashboard", "layout");
  return { ok: !error && (deleted ?? []).length > 0 };
}
