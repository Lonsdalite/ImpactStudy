import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already redirects unauthenticated users; this is belt-and-braces.
  if (!user) {
    redirect("/login");
  }

  return (
    <main className="flex-1 px-6 py-12">
      <div className="max-w-4xl mx-auto space-y-8">
        <header>
          <p className="text-xs uppercase tracking-[0.18em] font-medium text-brand-plum-mid">
            Dashboard
          </p>
          <h1 className="mt-2 font-display text-4xl text-brand-plum">
            You&apos;re in.
          </h1>
          <p className="mt-2 text-brand-ink/70">
            Signed in as <span className="font-medium">{user.email}</span>.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Day 2 complete</CardTitle>
            <CardDescription>
              Foundations are live: Next.js 16 + Tailwind v4 + Supabase Auth +
              Drizzle (5 tables in Sydney). No content yet — that ships in
              Phase 1 starting Monday.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-brand-ink/80">
              <li className="flex items-baseline gap-2">
                <span className="text-brand-sage">✓</span>
                Magic-link auth working (you just used it)
              </li>
              <li className="flex items-baseline gap-2">
                <span className="text-brand-sage">✓</span>
                Postgres schema: tenants, users, memberships, students,
                student_parents
              </li>
              <li className="flex items-baseline gap-2">
                <span className="text-brand-sage">✓</span>
                Row Level Security enabled on every new table
              </li>
              <li className="flex items-baseline gap-2">
                <span className="text-brand-sage">✓</span>
                Brand kit: plum / cream / sage / gold, Inter + Fraunces
              </li>
            </ul>
          </CardContent>
        </Card>

        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            className="text-sm text-brand-plum-mid underline-offset-4 hover:underline"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
