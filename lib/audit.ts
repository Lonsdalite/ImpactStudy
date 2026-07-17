import "server-only";

import { db, schema } from "@/lib/db";

/**
 * The audit trail (Slice D — doc 06 §6, made non-optional by doc 35b §5.5).
 *
 * doc 06 §6 promised an audit log and B.5 consciously deferred it. Slice D ends
 * that deferral, because D is the slice where a tutor starts holding login
 * credentials for other people's children. A privileged action with no record is
 * one nobody can answer for afterwards — not to a parent, not to the Privacy
 * Commissioner, and not to Fatima herself when a child says "someone else got
 * into my account".
 *
 * Writes go on the Drizzle path deliberately: `authenticated` has SELECT on
 * audit_log and no other privilege (policies.sql §11h), so the log is
 * append-only because there is no grant to append, amend or erase with — not
 * because a policy says so.
 *
 * NEVER put a credential in `meta`. We record THAT a password was set and by
 * whom; the password itself exists only as Supabase Auth's hash. Same for
 * anything else that would turn the trail into a second copy of the secret.
 */

/** The actions we record. A closed union rather than free text so the log stays
 *  greppable and a typo can't quietly create a category nobody reviews. */
export type AuditAction =
  | "student_account.create"
  | "student_account.reset_password"
  | "student_account.revoke"
  | "student_login.locked";

export async function recordAudit(input: {
  tenantId: string;
  actorUserId?: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      meta: input.meta ?? {},
    });
  } catch (err) {
    // Deliberately non-fatal. The alternative — failing a password reset because
    // the log write failed — would leave the tutor unable to help a locked-out
    // child, which is a worse outcome than a gap in the trail. Surfaced to the
    // server console (and Sentry, which captures console errors) so the gap is
    // noticed rather than silent.
    console.error("[audit] failed to record", input.action, err);
  }
}
