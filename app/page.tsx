import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";

const steps = [
  {
    n: "01",
    title: "Your tutor's voice",
    body: "Every explanation, hint, and nudge is written in your tutor's own warm, direct style — not a generic chatbot. The maths is universal; the voice is theirs.",
  },
  {
    n: "02",
    title: "Adaptive daily practice",
    body: "Fresh questions every day, aimed squarely at each student's weakest concepts. Mastery grows where it's thin, instead of drilling what's already solid.",
  },
  {
    n: "03",
    title: "Parent heartbeat",
    body: "Parents get a daily micro-win and a weekly progress report — real signal on what their child actually practised and mastered, not just attendance.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="flex flex-col items-center px-6 pt-16 pb-20 text-center">
          <div className="flex w-full max-w-2xl flex-col items-center gap-8">
            <Image
              src="/brand/seal.png"
              alt="ImpactStudy"
              width={224}
              height={224}
              priority
              className="select-none"
            />

            <h1 className="font-display text-5xl leading-[1.05] tracking-tight text-brand-plum sm:text-6xl">
              Maths Mastery,
              <br />
              Personalised.
            </h1>

            <p className="max-w-lg text-lg leading-relaxed text-brand-ink/75">
              Your tutor, available 24/7. Adaptive practice that targets your
              weakest concepts. Parents see real progress every day.
            </p>

            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex h-12 items-center justify-center rounded-full bg-brand-plum px-7 text-base font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid"
              >
                Sign in
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex h-12 items-center justify-center rounded-full border border-brand-plum/15 bg-transparent px-7 text-base font-medium text-brand-plum transition-colors hover:border-brand-plum/30 hover:bg-brand-plum/[0.04]"
              >
                How it works
              </a>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          className="scroll-mt-20 border-t border-brand-mist/60 bg-brand-plum/[0.025] px-6 py-20"
        >
          <div className="mx-auto max-w-5xl">
            <p className="text-sm font-medium uppercase tracking-[0.12em] text-brand-plum-mid">
              How it works
            </p>
            <h2 className="mt-3 max-w-2xl font-display text-3xl leading-tight tracking-tight text-brand-plum sm:text-4xl">
              The tutor&apos;s pedagogy is the product.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-brand-ink/70">
              ImpactStudy wraps three things around one tutor&apos;s way of teaching —
              so students get the same standard every day, and parents can see
              it.
            </p>

            <div className="mt-12 grid gap-5 sm:grid-cols-3">
              {steps.map((s) => (
                <div
                  key={s.n}
                  className="flex flex-col rounded-2xl border border-brand-mist bg-white p-6"
                >
                  <span className="font-display text-2xl text-brand-sage">
                    {s.n}
                  </span>
                  <h3 className="mt-3 text-lg font-medium text-brand-plum">
                    {s.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-brand-ink/70">
                    {s.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Programs teaser */}
        <section className="border-t border-brand-mist/60 px-6 py-20">
          <div className="mx-auto flex max-w-5xl flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl">
              <h2 className="font-display text-3xl leading-tight tracking-tight text-brand-plum">
                Maths Mastery intensives
              </h2>
              <p className="mt-3 text-base leading-relaxed text-brand-ink/70">
                Ratio &amp; Proportion, Unit Rates, Percentages, and Conversions
                — focused programs built for Years 5 to 8.
              </p>
            </div>
            <Link
              href="/programs"
              className="inline-flex h-12 shrink-0 items-center justify-center rounded-full border border-brand-plum/15 px-7 text-base font-medium text-brand-plum transition-colors hover:border-brand-plum/30 hover:bg-brand-plum/[0.04]"
            >
              Explore the programs
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
