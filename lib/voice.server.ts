import "server-only";

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { VoiceSignature } from "@/lib/voice-types";

/**
 * Tenant voice-signature access (Slice D — doc 35b §5.1).
 *
 * `tenants.voice_signature` is the Pedagogy Style Guide: the moat, and the prompt
 * behind every parent note and every piece of homework feedback. Until Slice D it
 * was read on the PostgREST path, guarded by `tenants_select_member` — "any
 * member of this tenant, any role". That was already loose (parents could read
 * it) and became untenable the moment a `student` membership existed: RLS is
 * ROW-level, and staff/parents/students all share the `authenticated` role, so no
 * policy could keep the column from a child's account.
 *
 * The fix is a COLUMN PRIVILEGE — `authenticated` is simply not granted
 * voice_signature (policies.sql §3) — which means nothing on the PostgREST path
 * can select it, staff included. So every read and write moves here, onto
 * Drizzle: it connects as the Postgres role, bypasses RLS by design, and filters
 * tenant_id in code (doc 06 §3). Same shape as the report drafter, which has
 * always worked this way.
 *
 * Hence the ONE rule for this module: callers must have already established who
 * is asking (requireStaff) and pass that tenant's id. There is no ambient scoping
 * here to save you.
 */

/** The tenant's captured voice, or null if she hasn't captured one yet. Callers
 *  that generate text fall back to FATIMA_VOICE; callers that only need to know
 *  whether to nudge her (the Homework hub) check for null. */
export async function getTenantVoice(
  tenantId: string,
): Promise<VoiceSignature | null> {
  const [row] = await db
    .select({ voice: schema.tenants.voiceSignature })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  return row?.voice ?? null;
}

export async function setTenantVoice(
  tenantId: string,
  voice: VoiceSignature,
): Promise<void> {
  await db
    .update(schema.tenants)
    .set({ voiceSignature: voice })
    .where(eq(schema.tenants.id, tenantId));
}
