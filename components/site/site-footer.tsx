import Link from "next/link";

/**
 * Marketing-surface footer. Composed per public page, like SiteHeader.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  const link = "transition-colors hover:text-brand-plum";

  return (
    <footer className="border-t border-brand-mist/70 bg-brand-cream">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-brand-ink/55 sm:flex-row">
        <p>© {year} ImpactStudy · Maths Mastery, personalised.</p>
        <nav className="flex items-center gap-5">
          <Link href="/programs" className={link}>
            Programs
          </Link>
          <Link href="/about" className={link}>
            About
          </Link>
          <Link href="/login" className={link}>
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
