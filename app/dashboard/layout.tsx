import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveTenant } from "@/lib/tenant";
import { DashboardChrome } from "@/components/dashboard/dashboard-chrome";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const result = await resolveActiveTenant();

  if (result.status === "select") {
    redirect("/tenant-select");
  }

  if (result.status === "none") {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="max-w-md text-center">
          <h1 className="font-display text-3xl tracking-tight text-brand-plum">
No practice yet
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-brand-ink/65">
            You&apos;re signed in as{" "}
            <span className="font-medium">{user.email}</span>, but you&apos;re
            not part of a practice yet. Once a tutor adds you, it&apos;ll appear
            here.
          </p>
          <form action="/auth/sign-out" method="post" className="mt-6">
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

  const { tenant, memberships } = result;
  const isStaff = ["owner", "admin", "tutor"].includes(tenant.role);

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <DashboardChrome
        tenantName={tenant.displayName}
        role={tenant.role}
        canSwitch={memberships.length > 1}
        userEmail={user.email ?? ""}
        isStaff={isStaff}
      />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
