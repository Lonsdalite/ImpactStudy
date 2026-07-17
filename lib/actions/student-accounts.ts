"use server";

import { revalidatePath } from "next/cache";
import { eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { resolveActiveTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import {
  emailForUsername,
  generatePassword,
  normaliseUsername,
  suggestCredentials,
  validatePassword,
  validateUsername,
} from "@/lib/student-credentials";

/**
 * Student portal account lifecycle (Slice D — doc 26 §2D + doc 35b §5.5).
 *
 * The tutor provisions; there is NO public self-signup and no route that lets a
 * student or parent create, rename or re-password an account. That is the locked
 * decision, and for minors it is also the compliance story: parent-mediated
 * provisioning is what keeps us clean under the Australian Privacy Principles.
 *
 * Every action here follows the same four beats, in this order:
 *   1. requireStaff()  — the admin client has no idea who is asking; we must.
 *   2. verify the student is in the ACTIVE tenant — the admin client bypasses
 *      RLS, so tenant scoping is ours to do in code (doc 06 §3). Skipping this
 *      is how a two-tenant staff member could reset another tenant's child's
 *      password.
 *   3. do the privileged thing via auth.admin.
 *   4. recordAudit() — the trail is why we're allowed to hold this at all.
 *
 * A generated password is returned to the caller EXACTLY ONCE, for the tutor to
 * hand over, and is never persisted, logged or audited. If she loses it, the
 * answer is a reset — which is cheap on purpose.
 */

type StaffTenant = { tenantId: string; role: string };

async function requireStaff(): Promise<StaffTenant | null> {
  const res = await resolveActiveTenant();
  if (res.status !== "ok") return null;
  if (!["owner", "admin", "tutor"].includes(res.tenant.role)) return null;
  return res.tenant;
}

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** The student, but only if they belong to the caller's active tenant. Every
 *  action funnels through this — it is the tenant scope for the whole file. */
async function studentInTenant(studentId: string, tenantId: string) {
  const [row] = await db
    .select({
      id: schema.students.id,
      tenantId: schema.students.tenantId,
      firstName: schema.students.firstName,
      userId: schema.students.userId,
      username: schema.students.username,
    })
    .from(schema.students)
    .where(eq(schema.students.id, studentId))
    .limit(1);
  if (!row || row.tenantId !== tenantId) return null;
  return row;
}

export interface StudentAccountSuggestion {
  username: string;
  password: string;
}

/**
 * Suggest a username + password for a student who has no login yet, so Fatima
 * isn't inventing credentials by hand for twenty children.
 *
 * Usernames are global (the synthetic email derives from them), so the taken-set
 * is deliberately read across ALL tenants — this is the one place tenant scoping
 * is intentionally absent, and it leaks nothing: it returns a username that is
 * FREE, never one that exists.
 */
export async function suggestStudentCredentials(
  studentId: string,
): Promise<{ ok: boolean; suggestion?: StudentAccountSuggestion; error?: string }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, error: "Only tutors and admins can do this." };
  const student = await studentInTenant(studentId, tenant.tenantId);
  if (!student) return { ok: false, error: "Student not found." };

  const taken = await db
    .select({ username: schema.students.username })
    .from(schema.students)
    .where(isNotNull(schema.students.username));

  return {
    ok: true,
    // First name only, never the full legal name — the handle becomes the name
    // in AI-prompt text (doc 35e §1).
    suggestion: suggestCredentials(
      student.firstName,
      taken.map((t) => t.username as string),
    ),
  };
}

/**
 * Create the portal login. Three things must land together — the auth user, the
 * `student` membership, and the students.user_id/username link — and a partial
 * result is a broken account, so failures roll back what they created.
 */
export async function createStudentAccount(input: {
  studentId: string;
  username: string;
  password: string;
}): Promise<{ ok: boolean; username?: string; error?: string }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, error: "Only tutors and admins can do this." };

  const student = await studentInTenant(input.studentId, tenant.tenantId);
  if (!student) return { ok: false, error: "Student not found." };
  if (student.userId) {
    return { ok: false, error: "This student already has a login. Reset the password instead." };
  }

  const username = normaliseUsername(input.username);
  const usernameError = validateUsername(username);
  if (usernameError) return { ok: false, error: usernameError };
  const passwordError = validatePassword(input.password);
  if (passwordError) return { ok: false, error: passwordError };

  const admin = createAdminClient();
  const email = emailForUsername(username);

  // email_confirm: true — there is no inbox to confirm from (the domain is
  // RFC 2606 `.invalid` and will never resolve), so the account must be usable
  // immediately. This also means Supabase sends nothing anywhere.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: student.firstName, is_student: true },
  });

  if (createError || !created?.user) {
    // The likeliest cause by far, and the one worth naming precisely: the handle
    // is taken. Usernames are global, so it may be taken in another tenant —
    // which we must NOT confirm ("someone else has it" would be a cross-tenant
    // existence oracle). "Try another" is true and says nothing.
    const msg = createError?.message ?? "";
    if (/already|exists|registered|duplicate/i.test(msg)) {
      return { ok: false, error: "That username is taken. Try another." };
    }
    console.error("[student-accounts] createUser failed", createError);
    return { ok: false, error: "Couldn't create the login. Try again." };
  }

  const authUserId = created.user.id;

  try {
    // The handle_new_user trigger already mirrored auth.users → public.users, so
    // the FKs below have something to point at.
    await db
      .insert(schema.memberships)
      .values({ tenantId: tenant.tenantId, userId: authUserId, role: "student" })
      .onConflictDoNothing();

    await db
      .update(schema.students)
      .set({ userId: authUserId, username })
      .where(eq(schema.students.id, student.id));
  } catch (err) {
    // Roll the auth user back rather than leaving an orphan that owns a username
    // (and therefore blocks the tutor from simply retrying with the same one).
    console.error("[student-accounts] link failed, rolling back auth user", err);
    await admin.auth.admin.deleteUser(authUserId).catch(() => {});
    return { ok: false, error: "Couldn't finish creating the login. Try again." };
  }

  await recordAudit({
    tenantId: tenant.tenantId,
    actorUserId: await currentUserId(),
    action: "student_account.create",
    targetType: "student",
    targetId: student.id,
    // The username identifies the account; the password never appears here.
    meta: { username, authUserId },
  });

  revalidatePath(`/dashboard/students/${student.id}`);
  return { ok: true, username };
}

/**
 * Reset the password — the tutor's answer to "I forgot it" and to "someone else
 * saw my card". Returns the new password once, for her to hand over.
 */
export async function resetStudentPassword(input: {
  studentId: string;
  password?: string;
}): Promise<{ ok: boolean; password?: string; error?: string }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, error: "Only tutors and admins can do this." };

  const student = await studentInTenant(input.studentId, tenant.tenantId);
  if (!student) return { ok: false, error: "Student not found." };
  if (!student.userId) {
    return { ok: false, error: "This student doesn't have a login yet." };
  }

  const password = input.password?.trim() ? input.password : generatePassword();
  const passwordError = validatePassword(password);
  if (passwordError) return { ok: false, error: passwordError };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(student.userId, {
    password,
  });
  if (error) {
    console.error("[student-accounts] password reset failed", error);
    return { ok: false, error: "Couldn't reset the password. Try again." };
  }

  // Clear any lockout: a reset is the tutor vouching for the child in person,
  // and making them wait out a lockout they didn't cause would be absurd.
  if (student.username) {
    await db
      .delete(schema.studentLoginAttempts)
      .where(eq(schema.studentLoginAttempts.username, student.username))
      .catch(() => {});
  }

  await recordAudit({
    tenantId: tenant.tenantId,
    actorUserId: await currentUserId(),
    action: "student_account.reset_password",
    targetType: "student",
    targetId: student.id,
    meta: { username: student.username },
  });

  revalidatePath(`/dashboard/students/${student.id}`);
  return { ok: true, password };
}

/**
 * Revoke the login entirely. Deletes the auth user (which cascades the
 * membership via public.users) and frees the username for re-use.
 *
 * The STUDENT ROW AND ALL THEIR WORK SURVIVE: students.user_id is ON DELETE SET
 * NULL, so revoking a compromised login must never take a child's homework
 * history with it. Deliberately a real delete rather than a disable — a
 * credential you have decided to revoke should stop existing.
 */
export async function revokeStudentAccount(
  studentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const tenant = await requireStaff();
  if (!tenant) return { ok: false, error: "Only tutors and admins can do this." };

  const student = await studentInTenant(studentId, tenant.tenantId);
  if (!student) return { ok: false, error: "Student not found." };
  if (!student.userId) return { ok: false, error: "This student doesn't have a login." };

  const admin = createAdminClient();
  const revokedUserId = student.userId;
  const { error } = await admin.auth.admin.deleteUser(revokedUserId);
  if (error) {
    console.error("[student-accounts] revoke failed", error);
    return { ok: false, error: "Couldn't remove the login. Try again." };
  }

  // public.users only MIRRORS auth.users — there's no FK between them, so the
  // delete above leaves this row behind, still holding the synthetic email.
  // public.users.email is UNIQUE, so an orphan makes the username unreusable:
  // reissuing it would fail inside handle_new_user with an opaque 500 (caught by
  // the Slice D live probe). Clear it here; the trigger has a backstop for
  // orphans made any other way. This cascades the stale membership too.
  await db.delete(schema.users).where(eq(schema.users.id, revokedUserId));

  // students.user_id is ON DELETE SET NULL, so the line above already nulled it —
  // but the USERNAME is ours to free, and the student row itself (and all their
  // homework) must survive a revoked credential.
  await db
    .update(schema.students)
    .set({ userId: null, username: null })
    .where(eq(schema.students.id, student.id));

  if (student.username) {
    await db
      .delete(schema.studentLoginAttempts)
      .where(eq(schema.studentLoginAttempts.username, student.username))
      .catch(() => {});
  }

  await recordAudit({
    tenantId: tenant.tenantId,
    actorUserId: await currentUserId(),
    action: "student_account.revoke",
    targetType: "student",
    targetId: student.id,
    meta: { username: student.username },
  });

  revalidatePath(`/dashboard/students/${student.id}`);
  return { ok: true };
}
