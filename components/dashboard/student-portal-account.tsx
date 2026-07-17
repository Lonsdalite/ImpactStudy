"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createStudentAccount,
  resetStudentPassword,
  revokeStudentAccount,
  suggestStudentCredentials,
} from "@/lib/actions/student-accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The tutor's credential controls for a student's portal login (Slice D —
 * doc 26 §2D). Create, reset, revoke — the tutor provisions, nobody self-signs up.
 *
 * The design problem this screen actually solves: Fatima is not going to invent
 * twenty usernames and twenty memorable passwords by hand, and if she does
 * they'll be a pattern any child in the practice can guess. So the generator
 * proposes both, from the student's FIRST NAME ONLY (never the full legal name —
 * doc 35e §1: the handle becomes the name we put in AI-prompt text). Both fields
 * stay editable: it's a suggestion, not a policy.
 *
 * The password is shown EXACTLY ONCE, right after it's set, and is never stored
 * anywhere we can read back — not in the students row, not in the audit log. If
 * she loses it before handing it over, the answer is Reset, which is one tap and
 * costs nothing. That's a deliberate trade: a recoverable password would mean
 * we're holding children's credentials in readable form, which is precisely what
 * we shouldn't be doing.
 */

interface PortalAccountProps {
  studentId: string;
  studentName: string;
  firstName: string;
  username: string | null;
}

export function StudentPortalAccount({
  studentId,
  studentName,
  firstName,
  username,
}: PortalAccountProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [draftUsername, setDraftUsername] = useState("");
  const [draftPassword, setDraftPassword] = useState("");
  // The one-time reveal. Cleared on dismiss; never re-fetchable.
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(
    null,
  );
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  function beginCreate() {
    startTransition(async () => {
      const res = await suggestStudentCredentials(studentId);
      if (!res.ok || !res.suggestion) {
        toast.error(res.error ?? "Couldn't suggest a login.");
        return;
      }
      setDraftUsername(res.suggestion.username);
      setDraftPassword(res.suggestion.password);
      setCreating(true);
    });
  }

  function create() {
    startTransition(async () => {
      const res = await createStudentAccount({
        studentId,
        username: draftUsername,
        password: draftPassword,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't create the login.");
        return;
      }
      setIssued({ username: draftUsername, password: draftPassword });
      setCreating(false);
      setDraftUsername("");
      setDraftPassword("");
      toast.success(`Login created for ${firstName}`);
      router.refresh();
    });
  }

  function reset() {
    startTransition(async () => {
      const res = await resetStudentPassword({ studentId });
      if (!res.ok || !res.password) {
        toast.error(res.error ?? "Couldn't reset the password.");
        return;
      }
      setIssued({ username: username ?? "", password: res.password });
      toast.success("New password ready to hand over");
      router.refresh();
    });
  }

  function revoke() {
    startTransition(async () => {
      const res = await revokeStudentAccount(studentId);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't remove the login.");
        return;
      }
      setConfirmingRevoke(false);
      setIssued(null);
      toast.success(`Portal login removed for ${firstName}`);
      router.refresh();
    });
  }

  async function copyBoth(u: string, p: string) {
    try {
      await navigator.clipboard.writeText(
        `ImpactStudy login for ${studentName}\nUsername: ${u}\nPassword: ${p}`,
      );
      toast.success("Copied — paste it to the parent");
    } catch {
      toast.error("Couldn't copy. Write it down instead.");
    }
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium text-brand-plum">Portal login</h2>
      <p className="mt-1 text-xs text-brand-ink/55">
        {username
          ? `${firstName} can sign in to see their homework, download worksheets and hand work in.`
          : `Create a login so ${firstName} can see their homework and hand work in. Give it to them — and let their parent know.`}
      </p>

      <div className="mt-3 rounded-2xl border border-brand-mist bg-white p-5">
        {/* One-time credential reveal. Sits above everything else because it's
            the only thing that matters while it's on screen. */}
        {issued ? (
          <div className="mb-4 rounded-xl border border-brand-gold/40 bg-brand-gold/10 p-4">
            <p className="text-sm font-medium text-brand-plum">
              Write this down now
            </p>
            <p className="mt-1 text-xs text-brand-ink/65">
              The password isn&apos;t stored anywhere and can&apos;t be shown
              again. Lost it? Just reset it.
            </p>
            <dl className="mt-3 space-y-1 font-mono text-sm text-brand-ink">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-brand-ink/50">Username</dt>
                <dd className="break-all">{issued.username}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-brand-ink/50">Password</dt>
                <dd className="break-all">{issued.password}</dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                onClick={() => copyBoth(issued.username, issued.password)}
              >
                Copy
              </Button>
              <button
                type="button"
                onClick={() => setIssued(null)}
                className="min-h-11 px-1 text-sm text-brand-ink/55 underline-offset-4 hover:underline"
              >
                Done
              </button>
            </div>
          </div>
        ) : null}

        {username ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs text-brand-ink/50">Username</p>
              <p className="font-mono text-sm text-brand-ink">{username}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                disabled={isPending}
                onClick={reset}
              >
                Reset password
              </Button>
              {/* Two-step confirm, in-app — same pattern as delete-student. A
                  revoke is recoverable (make a new login) but it does lock a
                  child out mid-week, so it shouldn't be a single stray tap. */}
              {confirmingRevoke ? (
                <>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={revoke}
                    className="min-h-11 px-1 text-sm font-medium text-red-600 underline-offset-4 hover:underline"
                  >
                    Really remove access?
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingRevoke(false)}
                    className="min-h-11 px-1 text-sm text-brand-ink/55 underline-offset-4 hover:underline"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingRevoke(true)}
                  className="min-h-11 px-1 text-sm text-brand-ink/55 underline-offset-4 hover:underline"
                >
                  Remove access
                </button>
              )}
            </div>
          </div>
        ) : creating ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="portal-username">Username</Label>
              <Input
                id="portal-username"
                value={draftUsername}
                onChange={(e) => setDraftUsername(e.target.value)}
                disabled={isPending}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-h-11 font-mono"
              />
              <p className="text-xs text-brand-ink/50">
                A nickname and some numbers. Don&apos;t use their full name —
                this is what we send to the AI when marking their work.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="portal-password">Password</Label>
              <Input
                id="portal-password"
                value={draftPassword}
                onChange={(e) => setDraftPassword(e.target.value)}
                disabled={isPending}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-h-11 font-mono"
              />
              <p className="text-xs text-brand-ink/50">
                Easy to read out and retype. Change it if you like.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                className="min-h-11"
                disabled={isPending || !draftUsername || !draftPassword}
                onClick={create}
              >
                {isPending ? "Creating…" : "Create login"}
              </Button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                disabled={isPending}
                className="min-h-11 px-1 text-sm text-brand-ink/55 underline-offset-4 hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-brand-ink/60">No login yet.</p>
            <Button
              type="button"
              className="min-h-11"
              disabled={isPending}
              onClick={beginCreate}
            >
              {isPending ? "…" : "Create login"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
