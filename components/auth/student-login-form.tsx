"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { signInStudent } from "@/lib/actions/student-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Student sign-in (Slice D — doc 26 §2D): username + password, no email.
 *
 * Deliberately NOT the magic-link form. A Year-5 student hasn't got an inbox, and
 * the PKCE path is brittle besides (docs 22/24) — so this is a separate
 * credential flow, not a variant of the existing one.
 *
 * The sign-in runs as a SERVER action, which is what makes the lockout possible:
 * calling supabase.auth.signInWithPassword straight from the browser would put
 * the guess-rate limiter on the attacker's side of the wire. The server action
 * checks the lockout, signs in, sets the session cookie, and returns one generic
 * message for every kind of failure (see student-auth.ts — anything more specific
 * is a username oracle pointed at children's accounts).
 */
export function StudentLoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;

    startTransition(async () => {
      const res = await signInStudent({ username, password });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't sign you in.");
        setPassword("");
        return;
      }
      // The action set the session cookie; refresh so the server re-reads it.
      router.replace("/portal");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={isPending}
              autoFocus
              autoComplete="username"
              // A phone keyboard that autocapitalises or autocorrects turns
              // "amara482" into "Amara482" and a mystified child. Usernames are
              // lowercase by normalisation, but don't fight the user first.
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="min-h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isPending}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="min-h-11"
            />
          </div>
          <Button
            type="submit"
            disabled={isPending || !username || !password}
            className="w-full"
            size="lg"
          >
            {isPending ? "Signing in…" : "Sign in"}
          </Button>
          <p className="pt-2 text-center text-xs text-brand-ink/55">
            Your tutor gives you your username and password. Forgotten it? Ask
            them to reset it.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
