import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MagicLinkForm } from "@/components/auth/magic-link-form";

interface LoginPageProps {
  searchParams: Promise<{ next?: string; message?: string }>;
}

export const metadata = {
  title: "Sign in",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // Server-side check: if already authenticated, skip the form.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect("/dashboard");
  }

  const params = await searchParams;

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md flex flex-col gap-8">
        <div className="text-center">
          <Link
            href="/"
            className="inline-block text-xs uppercase tracking-[0.18em] font-medium text-brand-plum-mid hover:text-brand-plum"
          >
            ImpactStudy
          </Link>
          <h1 className="mt-4 font-display text-4xl sm:text-5xl text-brand-plum leading-tight">
            Welcome back
          </h1>
          <p className="mt-3 text-brand-ink/70">
            Sign in with a magic link sent to your email.
          </p>
        </div>

        <MagicLinkForm next={params.next} />

        {params.message ? (
          <p className="text-sm text-center text-brand-plum-mid bg-brand-plum/[0.04] border border-brand-plum/15 rounded-lg px-4 py-3">
            {params.message}
          </p>
        ) : null}

        <p className="text-xs text-center text-brand-ink/50">
          New here? Same form — first sign-in creates your account.
        </p>
      </div>
    </main>
  );
}
