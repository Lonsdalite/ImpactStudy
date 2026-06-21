import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  ACTIVE_TENANT_COOKIE,
  getMemberships,
  type TenantMembership,
} from "@/lib/tenant";

export const metadata = {
  title: "Choose practice",
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  tutor: "Tutor",
  parent: "Parent",
  student: "Student",
};

// Server action: persist the chosen tenant (after re-checking membership via
// RLS) and head to the dashboard.
async function selectTenant(formData: FormData) {
  "use server";
  const tenantId = String(formData.get("tenantId") ?? "");
  const memberships = await getMemberships();
  if (!memberships.some((m) => m.tenantId === tenantId)) {
    redirect("/tenant-select");
  }
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TENANT_COOKIE, tenantId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 180, // 180 days
  });
  redirect("/dashboard");
}

export default async function TenantSelectPage() {
  const memberships = await getMemberships();

  // Nothing to choose between → let the dashboard handle 0/1 cases.
  if (memberships.length <= 1) {
    redirect("/dashboard");
  }

  const cookieStore = await cookies();
  const current = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <h1 className="font-display text-3xl tracking-tight text-brand-plum">
          Choose a practice
        </h1>
        <p className="mt-2 text-sm text-brand-ink/65">
          You belong to more than one practice. Pick which one to work in.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          {memberships.map((m: TenantMembership) => (
            <form key={m.tenantId} action={selectTenant}>
              <input type="hidden" name="tenantId" value={m.tenantId} />
              <button
                type="submit"
                className="flex w-full items-center justify-between rounded-2xl border border-brand-mist bg-white p-5 text-left transition-colors hover:border-brand-plum/30 hover:bg-brand-plum/[0.03]"
              >
                <span>
                  <span className="block font-medium text-brand-plum">
                    {m.displayName}
                  </span>
                  <span className="mt-0.5 block text-xs text-brand-ink/55">
                    {ROLE_LABEL[m.role] ?? m.role}
                  </span>
                </span>
                {current === m.tenantId ? (
                  <span className="rounded-full bg-brand-sage/15 px-3 py-1 text-xs font-medium text-brand-plum">
                    Current
                  </span>
                ) : (
                  <span className="text-sm text-brand-plum-mid">Open →</span>
                )}
              </button>
            </form>
          ))}
        </div>

        <form action="/auth/sign-out" method="post" className="mt-8">
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
