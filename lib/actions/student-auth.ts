"use server";

import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit";
import { emailForUsername, normaliseUsername } from "@/lib/student-credentials";

/**
 * Student sign-in: username + password (Slice D — doc 26 §2D).
 *
 * A SEPARATE credential flow, not a variation on the magic link. The magic-link
 * PKCE path is brittle (docs 22/24) and presumes an inbox, which a Year-5 student
 * generally hasn't got — hence "no email required". The address Supabase Auth is
 * keyed by is DERIVED from the username (lib/student-credentials.ts), so this
 * path needs no username→email lookup and exposes no table that would answer
 * "which handles exist?".
 *
 * This is the only unauthenticated write surface in the app, so it is also the
 * only place with a lockout. doc 35b §5.5 named the trade plainly: the generated
 * passwords are memorable BECAUSE they are for children, which makes them weak
 * (~2²⁰) by design. That is survivable only because the exposure is online-only —
 * there is no hash to grind offline — and this function caps the guess rate.
 * Remove the lockout and the generator becomes the vulnerability.
 */

/** Failures before we lock. Generous enough that a child fat-fingering a
 *  password off a printed card never trips it; far below what 2²⁰ needs. */
const MAX_FAILURES = 8;
/** Lock duration. Long enough to make guessing hopeless (8 tries per 15 min ≈
 *  32/hour vs ~10⁶ candidates), short enough that a locked-out child can be back
 *  in the same lesson — and the tutor can clear it instantly with a reset. */
const LOCKOUT_MINUTES = 15;
/** A quiet spell means the earlier failures were noise (a forgotten password),
 *  not an attack — so the counter decays instead of accumulating across weeks
 *  until an honest child is locked out by their own history. */
const FAILURE_WINDOW_MINUTES = 15;

export interface StudentSignInResult {
  ok: boolean;
  error?: string;
}

/**
 * ONE message for every failure — wrong password, unknown username, revoked
 * account, not-a-student. Anything more specific is a username oracle, and these
 * are children's accounts: "no such user" tells an attacker which handles to
 * spend their guesses on. The tutor can always see the real state on the student
 * record; the login box says nothing.
 */
const GENERIC_FAILURE = "That username and password don't match. Check with your tutor.";

export async function signInStudent(input: {
  username: string;
  password: string;
}): Promise<StudentSignInResult> {
  const username = normaliseUsername(input.username ?? "");
  if (!username || !input.password) {
    return { ok: false, error: GENERIC_FAILURE };
  }

  const now = new Date();

  // --- lockout check (before we spend an auth round-trip) ---
  const [attempt] = await db
    .select()
    .from(schema.studentLoginAttempts)
    .where(eq(schema.studentLoginAttempts.username, username))
    .limit(1);

  if (attempt?.lockedUntil && attempt.lockedUntil > now) {
    const minutes = Math.max(
      1,
      Math.ceil((attempt.lockedUntil.getTime() - now.getTime()) / 60000),
    );
    return {
      ok: false,
      error: `Too many tries. Wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again, or ask your tutor to reset your password.`,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailForUsername(username),
    password: input.password,
  });

  if (error || !data.user) {
    await recordFailure(username, attempt, now);
    return { ok: false, error: GENERIC_FAILURE };
  }

  // Authenticated — but is this actually a student account? A staff or parent
  // user could not reach here (their email isn't on the .invalid domain, so the
  // derived address wouldn't match theirs), but the portal grants a `student`
  // membership's view of the world and must not be reachable without one. Fail
  // CLOSED: sign back out rather than leave a half-authorised session.
  const [student] = await db
    .select({ id: schema.students.id })
    .from(schema.students)
    .innerJoin(
      schema.memberships,
      sql`${schema.memberships.userId} = ${schema.students.userId}
          and ${schema.memberships.tenantId} = ${schema.students.tenantId}
          and ${schema.memberships.role} = 'student'`,
    )
    .where(eq(schema.students.userId, data.user.id))
    .limit(1);

  if (!student) {
    await supabase.auth.signOut();
    await recordFailure(username, attempt, now);
    return { ok: false, error: GENERIC_FAILURE };
  }

  // Success wipes the slate — an honest child who got it wrong twice then right
  // starts clean.
  await db
    .delete(schema.studentLoginAttempts)
    .where(eq(schema.studentLoginAttempts.username, username))
    .catch(() => {});

  return { ok: true };
}

async function recordFailure(
  username: string,
  prior: typeof schema.studentLoginAttempts.$inferSelect | undefined,
  now: Date,
): Promise<void> {
  const windowStart = new Date(now.getTime() - FAILURE_WINDOW_MINUTES * 60000);
  // Decay: only failures inside the window count toward the lock.
  const priorCount =
    prior && prior.lastAttemptAt > windowStart ? prior.failedCount : 0;
  const failedCount = priorCount + 1;
  const locked = failedCount >= MAX_FAILURES;
  const lockedUntil = locked
    ? new Date(now.getTime() + LOCKOUT_MINUTES * 60000)
    : null;

  try {
    await db
      .insert(schema.studentLoginAttempts)
      .values({ username, failedCount, lockedUntil, lastAttemptAt: now })
      .onConflictDoUpdate({
        target: schema.studentLoginAttempts.username,
        set: { failedCount, lockedUntil, lastAttemptAt: now },
      });
  } catch (err) {
    // Never let bookkeeping turn a failed login into a 500.
    console.error("[student-auth] couldn't record failed attempt", err);
  }

  if (!locked) return;

  // A lockout is worth a record — it is the signal that someone is guessing at a
  // child's account. Resolve the username to its tenant so the trail lands where
  // the responsible staff can actually read it (audit_log is tenant-scoped). An
  // unknown username has no tenant and so is deliberately NOT logged: it belongs
  // to nobody, and logging it would let an attacker write to our audit table.
  const [owner] = await db
    .select({ tenantId: schema.students.tenantId, id: schema.students.id })
    .from(schema.students)
    .where(eq(schema.students.username, username))
    .limit(1);
  if (!owner) return;

  await recordAudit({
    tenantId: owner.tenantId,
    action: "student_login.locked",
    targetType: "student",
    targetId: owner.id,
    meta: { username, failedCount, lockedUntil: lockedUntil?.toISOString() },
  });
}
