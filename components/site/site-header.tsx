import Image from "next/image";
import Link from "next/link";

/**
 * Marketing-surface header. Composed per public page (home/about/programs), NOT
 * in the root layout, so it never appears on /login or /dashboard.
 */
export function SiteHeader() {
  const navLink =
    "inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-brand-plum/80 transition-colors hover:bg-brand-plum/[0.04] hover:text-brand-plum";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-brand-mist/70 bg-brand-cream/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/brand/seal.png"
            alt="ImpactStudy"
            width={36}
            height={36}
            priority
            className="select-none"
          />
          <span className="font-display text-lg text-brand-plum">
            ImpactStudy
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          <Link href="/programs" className={`hidden sm:inline-flex ${navLink}`}>
            Programs
          </Link>
          <Link href="/about" className={`hidden sm:inline-flex ${navLink}`}>
            About
          </Link>
          <Link
            href="/#how-it-works"
            className={`hidden sm:inline-flex ${navLink}`}
          >
            How it works
          </Link>
          <Link
            href="/login"
            className="ml-1 inline-flex h-9 items-center justify-center rounded-full bg-brand-plum px-5 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
