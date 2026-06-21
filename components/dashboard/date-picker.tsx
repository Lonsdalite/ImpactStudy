"use client";

import { useRouter } from "next/navigation";

/**
 * Native date input that navigates to `${basePath}?date=YYYY-MM-DD` on change.
 * Gives a real calendar popup (browser/OS native) so any date is one click
 * away — no clicking Prev/Next repeatedly.
 */
export function DatePicker({
  date,
  basePath,
}: {
  date: string;
  basePath: string;
}) {
  const router = useRouter();
  return (
    <input
      type="date"
      value={date}
      onChange={(e) => {
        const v = e.target.value;
        if (v) router.push(`${basePath}?date=${v}`);
      }}
      className="rounded-lg border border-brand-mist bg-white px-3 py-1.5 text-sm text-brand-plum focus:border-brand-plum-mid focus:outline-none"
      aria-label="Pick a date"
    />
  );
}
