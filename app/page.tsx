import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 bg-brand-cream">
      <main className="w-full max-w-2xl flex flex-col items-center text-center gap-8">
        {/*
         * The seal logo is the brand statement. Lock at 192px so it reads
         * confidently on desktop without dominating; scale down on small
         * screens via responsive utility if needed later.
         */}
        <Image
          src="/brand/seal.png"
          alt="ImpactStudy"
          width={224}
          height={224}
          priority
          className="select-none"
        />

        <h1 className="font-display text-5xl sm:text-6xl leading-[1.05] tracking-tight text-brand-plum">
          Maths Mastery,
          <br />
          Personalised.
        </h1>

        <p className="max-w-lg text-lg leading-relaxed text-brand-ink/75">
          Your tutor, available 24/7. Adaptive practice that targets your
          weakest concepts. Parents see real progress every day.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mt-2">
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
      </main>
    </div>
  );
}
