import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StudentLoginForm } from "@/components/auth/student-login-form";

export const metadata = { title: "Student sign in" };

/**
 * The student's front door (Slice D). Separate from /login because the whole
 * point is that it asks for no email — see components/auth/student-login-form.
 *
 * No sign-up link, by design and not by omission: accounts are tutor-provisioned
 * (doc 26 §2D). A child arriving here without credentials is meant to ask their
 * tutor, not create an account for themselves.
 */
export default async function StudentLoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Already signed in — /portal sorts out whether they belong there (a staff or
  // parent session gets bounced to /dashboard by the portal layout).
  if (user) redirect("/portal");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-md flex-col gap-8">
        <div className="text-center">
          <Link
            href="/"
            className="inline-block text-xs font-medium uppercase tracking-[0.18em] text-brand-plum-mid hover:text-brand-plum"
          >
            ImpactStudy
          </Link>
          <h1 className="mt-4 font-display text-4xl leading-tight text-brand-plum sm:text-5xl">
            Your homework
          </h1>
          <p className="mt-3 text-brand-ink/70">
            Sign in with the username and password your tutor gave you.
          </p>
        </div>

        <StudentLoginForm />

        <p className="text-center text-xs text-brand-ink/50">
          Are you a tutor or a parent?{" "}
          <Link href="/login" className="underline underline-offset-4">
            Sign in here
          </Link>
        </p>
      </div>
    </main>
  );
}
