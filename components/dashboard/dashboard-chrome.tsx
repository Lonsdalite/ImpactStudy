"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV: {
  href: string;
  label: string;
  parentLabel?: string;
  staffOnly?: boolean;
}[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/students", label: "Students", parentLabel: "Children" },
  { href: "/dashboard/attendance", label: "Attendance", staffOnly: true },
  { href: "/dashboard/billing", label: "Billing", staffOnly: true },
  { href: "/dashboard/practice", label: "Practice" },
  { href: "/dashboard/voice", label: "Voice", staffOnly: true },
  { href: "/dashboard/reports", label: "Reports", parentLabel: "Progress" },
];

// The product/brand name. Shown once in the sidebar. For the pilot the tenant's
// displayName is also "ImpactStudy", so we only surface the tenant name when it
// actually differs (i.e. a future second tenant) to avoid showing it twice.
const BRAND = "ImpactStudy";

// Product-aligned role labels. The owner of a tutoring practice IS the tutor, so
// we show "Tutor" rather than the technical "Owner".
const ROLE_LABEL: Record<string, string> = {
  owner: "Tutor",
  admin: "Admin",
  tutor: "Tutor",
  parent: "Parent",
  student: "Student",
};

function isActive(pathname: string, href: string) {
  return href === "/dashboard"
    ? pathname === "/dashboard"
    : pathname.startsWith(href);
}

export function DashboardChrome({
  tenantName,
  role,
  canSwitch,
  userEmail,
  isStaff,
}: {
  tenantName: string;
  role: string;
  canSwitch: boolean;
  userEmail: string;
  isStaff: boolean;
}) {
  const pathname = usePathname();
  const nav = NAV.filter((item) => !item.staffOnly || isStaff).map((item) => ({
    href: item.href,
    label: !isStaff && item.parentLabel ? item.parentLabel : item.label,
  }));

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-brand-mist bg-brand-cream md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <Image
            src="/brand/seal.png"
            alt="ImpactStudy"
            width={38}
            height={38}
            className="select-none"
          />
          <div className="min-w-0">
            <span className="block font-display text-lg leading-tight text-brand-plum">
              {BRAND}
            </span>
            <span className="block truncate text-xs text-brand-ink/55">
              {ROLE_LABEL[role] ?? role}
              {tenantName && tenantName !== BRAND ? ` · ${tenantName}` : ""}
            </span>
          </div>
        </div>

        <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-3">
          {nav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  "rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                  (active
                    ? "bg-brand-plum text-brand-cream"
                    : "text-brand-ink/70 hover:bg-brand-plum/[0.05] hover:text-brand-plum")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-brand-mist px-5 py-4">
          <p className="truncate text-xs text-brand-ink/55">{userEmail}</p>
          <div className="mt-2 flex items-center gap-3 text-xs">
            {canSwitch ? (
              <Link
                href="/tenant-select"
                className="text-brand-plum-mid hover:underline"
              >
                Switch
              </Link>
            ) : null}
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="text-brand-plum-mid underline-offset-4 hover:underline"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 border-b border-brand-mist bg-brand-cream/90 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <Image
              src="/brand/seal.png"
              alt="ImpactStudy"
              width={30}
              height={30}
              className="select-none"
            />
            <span className="truncate text-sm font-medium text-brand-plum">
              {tenantName && tenantName !== BRAND ? tenantName : BRAND}
            </span>
          </div>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="text-xs text-brand-plum-mid underline-offset-4 hover:underline"
            >
              Sign out
            </button>
          </form>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {nav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors " +
                  (active
                    ? "bg-brand-plum text-brand-cream"
                    : "text-brand-ink/70 hover:bg-brand-plum/[0.05]")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
