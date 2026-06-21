import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";

export const metadata: Metadata = {
  title: "Programs",
  description:
    "Maths Mastery intensives: Ratio & Proportion, Unit Rates, Percentages, and Conversions — focused programs for Years 5 to 8.",
};

const programs = [
  {
    title: "Ratio & Proportion Intensive",
    years: "Years 6–8",
    body: "Build real proportional reasoning — scaling recipes, maps, and mixtures — until ratio problems stop feeling like tricks and start feeling obvious.",
    topics: ["Equivalent ratios", "Scaling & sharing", "Proportional reasoning"],
  },
  {
    title: "Unit Rates",
    years: "Years 6–8",
    body: "Turn 'price per' and 'speed per' into a single reliable habit. Compare best buys, convert rates, and reason about change over time.",
    topics: ["Rates vs ratios", "Best-buy comparisons", "Rate conversions"],
  },
  {
    title: "Percentages",
    years: "Years 5–8",
    body: "From simple percentages to increase, decrease, and discount. The everyday maths students will use for the rest of their lives.",
    topics: ["Percent of a quantity", "Increase & decrease", "Discounts & GST"],
  },
  {
    title: "Conversions",
    years: "Years 5–7",
    body: "Move fluently between fractions, decimals, and percentages — the connective tissue that makes the rest of number sense click.",
    topics: ["Fractions ↔ decimals", "Decimals ↔ percentages", "Ordering & comparing"],
  },
];

export default function ProgramsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="flex flex-1 flex-col px-6 py-16">
        <div className="mx-auto w-full max-w-5xl">
          <p className="text-sm font-medium uppercase tracking-[0.12em] text-brand-plum-mid">
            Programs
          </p>
          <h1 className="mt-3 max-w-2xl font-display text-4xl leading-tight tracking-tight text-brand-plum sm:text-5xl">
            Maths Mastery intensives
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-brand-ink/75">
            Each program is a focused track, not a textbook. Students master one
            strand at a time, with daily practice tuned to where they actually
            struggle.
          </p>

          <div className="mt-12 grid gap-5 sm:grid-cols-2">
            {programs.map((p) => (
              <div
                key={p.title}
                className="flex flex-col rounded-2xl border border-brand-mist bg-white p-7"
              >
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-xl font-medium text-brand-plum">
                    {p.title}
                  </h2>
                  <span className="shrink-0 rounded-full bg-brand-sage/15 px-3 py-1 text-xs font-medium text-brand-plum">
                    {p.years}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-brand-ink/70">
                  {p.body}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {p.topics.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-brand-mist px-3 py-1 text-xs text-brand-ink/65"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-col items-start gap-4 rounded-2xl border border-brand-plum/15 bg-brand-plum/[0.03] p-7 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl text-base leading-relaxed text-brand-ink/75">
              Each student starts where they are. The AI tutor teaches in your
              tutor&apos;s voice; parents see the progress every day.
            </p>
            <Link
              href="/login"
              className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-brand-plum px-7 text-base font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid"
            >
              Sign in
            </Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
