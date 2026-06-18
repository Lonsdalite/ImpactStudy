"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

interface MagicLinkFormProps {
  next?: string;
}

export function MagicLinkForm({ next }: MagicLinkFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Cross-tab auth detection: when the user clicks the magic link in their
  // email (which typically opens a NEW tab), the original "Check your inbox"
  // tab should auto-redirect to /dashboard. Listener + polling fallback.
  useEffect(() => {
    if (!sent) return;
    const supabase = createClient();
    const target = next ?? "/dashboard";

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        router.replace(target);
        router.refresh();
      }
    });

    // Polling fallback in case the auth event doesn't propagate cross-tab.
    const pollInterval = window.setInterval(async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        window.clearInterval(pollInterval);
        router.replace(target);
        router.refresh();
      }
    }, 3000);

    return () => {
      subscription.unsubscribe();
      window.clearInterval(pollInterval);
    };
  }, [sent, next, router]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;

    startTransition(async () => {
      const supabase = createClient();
      const redirectTo = new URL("/auth/callback", window.location.origin);
      if (next) {
        redirectTo.searchParams.set("next", next);
      }

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo.toString(),
        },
      });

      if (error) {
        toast.error("Couldn't send magic link", {
          description: error.message,
        });
        return;
      }

      setSent(true);
      toast.success("Magic link sent", {
        description: `Check ${email} for a link to sign in.`,
      });
    });
  }

  if (sent) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-3 text-center">
          <p className="font-display text-2xl text-brand-plum leading-tight">
            Check your inbox
          </p>
          <p className="text-sm text-brand-ink/70">
            We sent a magic link to{" "}
            <span className="font-medium text-brand-ink">{email}</span>. Open
            it on this device to sign in. Link expires in 1 hour.
          </p>
          <p className="text-xs text-brand-ink/55 pt-1">
            Waiting for you to click the link — this page will jump to your
            dashboard automatically.
          </p>
          <button
            type="button"
            onClick={() => {
              setSent(false);
              setEmail("");
            }}
            className="text-sm text-brand-plum-mid underline-offset-4 hover:underline"
          >
            Use a different email
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isPending}
              autoFocus
              autoComplete="email"
            />
          </div>
          <Button
            type="submit"
            disabled={isPending || !email}
            className="w-full"
            size="lg"
          >
            {isPending ? "Sending..." : "Send magic link"}
          </Button>
          <p className="text-xs text-brand-ink/55 text-center pt-2">
            We&apos;ll email you a one-tap sign-in link. No password to
            remember.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
