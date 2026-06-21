import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";

export const metadata: Metadata = {
  title: "About",
  description:
    "ImpactStudy rebuilds private maths tutoring around one idea: the tutor's pedagogy is the product.",
};

export default function AboutPage() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="flex flex-1 flex-col px-6 py-16">
        <article className="mx-auto w-full max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-[0.12em] text-brand-plum-mid">
            About
          </p>
          <h1 className="mt-3 font-display text-4xl leading-tight tracking-tight text-brand-plum sm:text-5xl">
            The tutor is the product.
          </h1>

          <div className="mt-8 flex flex-col gap-6 text-lg leading-relaxed text-brand-ink/80">
            <p>
              Most tutoring software treats the tutor as an administrator —
              someone to schedule lessons and chase invoices. ImpactStudy starts
              from the opposite premise: the thing parents pay for is a
              tutor&apos;s judgement, voice, and way of teaching. That&apos;s
              what we set out to scale, not replace.
            </p>
            <p>
              Under the hood, the maths is universal — drawn from open,
              high-quality curriculum. What makes each tutor&apos;s students feel
              at home is the voice on top: the phrasing, the encouragement, the
              analogies, the standard they hold. We keep that voice intact and
              put it to work every day, for every student, at once.
            </p>
          </div>

          <h2 className="mt-12 font-display text-2xl tracking-tight text-brand-plum">
            What that looks like
          </h2>
          <div className="mt-5 flex flex-col gap-5">
            <div className="rounded-2xl border border-brand-mist bg-white p-6">
              <h3 className="text-base font-medium text-brand-plum">
                Adaptive practice, every day
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-brand-ink/70">
                A mastery graph tracks each student&apos;s weakest concepts and
                regenerates fresh questions daily — so practice is never busywork
                and never the same worksheet twice.
              </p>
            </div>
            <div className="rounded-2xl border border-brand-mist bg-white p-6">
              <h3 className="text-base font-medium text-brand-plum">
                A heartbeat for parents
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-brand-ink/70">
                Daily micro-wins and weekly reports give parents honest signal on
                what their child practised and mastered — written in the
                tutor&apos;s own voice.
              </p>
            </div>
            <div className="rounded-2xl border border-brand-mist bg-white p-6">
              <h3 className="text-base font-medium text-brand-plum">
                Built for a real practice first
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-brand-ink/70">
                ImpactStudy is being built alongside a working Sydney maths
                practice — proven with real students before it&apos;s opened to
                other tutors.
              </p>
            </div>
          </div>

          <div className="mt-12 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <Link
              href="/programs"
              className="inline-flex h-12 items-center justify-center rounded-full bg-brand-plum px-7 text-base font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid"
            >
              See the programs
            </Link>
            <Link
              href="/#how-it-works"
              className="inline-flex h-12 items-center justify-center rounded-full border border-brand-plum/15 px-7 text-base font-medium text-brand-plum transition-colors hover:border-brand-plum/30 hover:bg-brand-plum/[0.04]"
            >
              How it works
            </Link>
          </div>
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}
