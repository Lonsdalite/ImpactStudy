"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import { defaultSessionMinutes } from "@/lib/billing";
import type { EnrollmentMode } from "@/lib/db/schema";

/**
 * Price-catalog + subject management (Slice A). Fatima-editable: subjects and the
 * (year × subject × mode) → hourly rate + default session length rows the
 * enrollment flow inherits from. Staff only (RLS enforces it too).
 */

const MODES: EnrollmentMode[] = ["one_to_one", "group"];

async function requireStaff() {
  const res = await resolveActiveTenant();
  if (res.status !== "ok") return null;
  if (!["owner", "admin", "tutor"].includes(res.tenant.role)) return null;
  return res.tenant;
}

// ---------- subjects ----------

export async function createSubject(
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, error: "Not allowed." };
  const clean = name?.trim();
  if (!clean) return { ok: false, error: "Subject name is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("subjects").insert({
    tenant_id: tenant.tenantId,
    name: clean,
  });
  if (error) {
    return {
      ok: false,
      error: /duplicate|unique/i.test(error.message)
        ? "That subject already exists."
        : "Couldn't add the subject.",
    };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function setSubjectActive(
  subjectId: string,
  active: boolean,
): Promise<{ ok: boolean }> {
  if (!(await requireStaff())) return { ok: false };
  if (!subjectId) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from("subjects")
    .update({ active })
    .eq("id", subjectId);
  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}

// ---------- price list ----------

/**
 * Insert or update the catalog row for (year × subject × mode). If session
 * minutes aren't supplied, use the mode default (1:1 → 60, group → 90).
 */
export async function savePriceListItem(input: {
  id?: string;
  yearLevel: string;
  subjectId: string;
  mode: EnrollmentMode;
  hourlyRateDollars: number;
  sessionMinutes?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, error: "Not allowed." };

  const yearLevel = input.yearLevel?.trim();
  if (!yearLevel) return { ok: false, error: "Year level is required." };
  if (!input.subjectId) return { ok: false, error: "Pick a subject." };
  if (!MODES.includes(input.mode)) return { ok: false, error: "Pick a mode." };
  if (!Number.isFinite(input.hourlyRateDollars) || input.hourlyRateDollars <= 0) {
    return { ok: false, error: "Enter an hourly rate." };
  }

  const hourlyRateCents = Math.round(input.hourlyRateDollars * 100);
  const sessionMinutes =
    Number.isFinite(input.sessionMinutes) && (input.sessionMinutes as number) > 0
      ? Math.round(input.sessionMinutes as number)
      : defaultSessionMinutes(input.mode);

  const supabase = await createClient();

  if (input.id) {
    const { error } = await supabase
      .from("price_list_items")
      .update({
        hourly_rate_cents: hourlyRateCents,
        default_session_minutes: sessionMinutes,
      })
      .eq("id", input.id);
    if (error) return { ok: false, error: "Couldn't save the rate." };
    revalidatePath("/dashboard", "layout");
    return { ok: true };
  }

  const { error } = await supabase.from("price_list_items").insert({
    tenant_id: tenant.tenantId,
    year_level: yearLevel,
    subject_id: input.subjectId,
    mode: input.mode,
    hourly_rate_cents: hourlyRateCents,
    default_session_minutes: sessionMinutes,
  });
  if (error) {
    return {
      ok: false,
      error: /duplicate|unique/i.test(error.message)
        ? "A rate for that year, subject and mode already exists — edit it instead."
        : "Couldn't add the rate.",
    };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function setPriceListItemActive(
  id: string,
  active: boolean,
): Promise<{ ok: boolean }> {
  if (!(await requireStaff())) return { ok: false };
  if (!id) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from("price_list_items")
    .update({ active })
    .eq("id", id);
  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}
