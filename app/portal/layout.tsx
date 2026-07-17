import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { requireStudent } from "@/lib/portal.server";

/**
 * The student portal shell (Slice D — doc 26 §2D).
 *
 * Deliberately NOT the dashboard chrome. The portal has one job — the homework
 * loop — so it has no nav to speak of: an inbox, and the way back to it. A
 * sidebar of greyed-out sections would only advertise to a child everything
 * they're not allowed to touch.
 *
 * This is also the role gate in the other direction: staff and parents are sent
 * to /dashboard, students there are sent here (app/dashboard/layout.tsx). One
 * choke point each.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireStudent();
  if (!me) redirect("/dashboard");

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-cream/30">
      <header className="border-b border-brand-mist bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3.5">
          <Link href="/portal" className="flex items-center gap-2.5">
            <Image
              src="/brand/seal.png"
              alt=""
              width={30}
              height={30}
              className="select-none"
            />
            <span className="font-display text-lg leading-none text-brand-plum">
              {me.tenantName}
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-brand-ink/60 sm:inline">
              {me.firstName}
            </span>
            <form action="/auth/sign-out" method="post">
              {/* min-h-11: thumb target on a phone (the C.5 390px pass). */}
              <button
                type="submit"
                className="flex min-h-11 items-center px-1 text-sm text-brand-plum-mid underline-offset-4 hover:underline"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
