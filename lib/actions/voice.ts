"use server";

import { revalidatePath } from "next/cache";
import { resolveActiveTenant } from "@/lib/tenant";
import { setTenantVoice } from "@/lib/voice.server";
import { extractVoiceSignature } from "@/lib/llm/extract-voice";
import type { VoiceSignature } from "@/lib/voice-types";

async function requireStaff() {
  const res = await resolveActiveTenant();
  if (res.status !== "ok") return null;
  if (!["owner", "admin", "tutor"].includes(res.tenant.role)) return null;
  return res.tenant;
}

/** Step 1: AI proposes a draft voice signature from pasted samples (not saved). */
export async function extractVoice(
  samples: string,
): Promise<{ ok: boolean; voice?: VoiceSignature; error?: string }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, error: "Only tutors and admins can do this." };
  if (!samples?.trim()) {
    return { ok: false, error: "Paste a few of your messages first." };
  }
  try {
    const voice = await extractVoiceSignature(samples);
    return { ok: true, voice };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Couldn't analyse the messages.",
    };
  }
}

/** Step 2: save the (reviewed/edited) voice signature to the tenant. */
export async function saveVoice(
  voice: VoiceSignature,
): Promise<{ ok: boolean; error?: string }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, error: "Only tutors and admins can do this." };
  if (!voice?.register?.trim()) {
    return { ok: false, error: "The voice needs at least a register/tone." };
  }
  const clean: VoiceSignature = {
    tutorName: voice.tutorName?.trim() ?? "",
    register: voice.register.trim(),
    openers: (voice.openers ?? []).map((s) => s.trim()).filter(Boolean),
    neverUse: (voice.neverUse ?? []).map((s) => s.trim()).filter(Boolean),
    patterns: (voice.patterns ?? []).map((s) => s.trim()).filter(Boolean),
  };

  // Drizzle, not supabase-js: `authenticated` has no column privilege on
  // tenants.voice_signature (policies.sql §3). Staff-gated above; tenant scoped
  // explicitly, per the doc 06 §3 rule for the RLS-bypassing path.
  try {
    await setTenantVoice(tenant.tenantId, clean);
  } catch (err) {
    console.error("[voice] save failed", err);
    return { ok: false, error: "Couldn't save your voice. Try again." };
  }

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
