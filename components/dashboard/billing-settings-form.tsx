"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BILLING_CYCLES } from "@/lib/billing";
import { updateBilling } from "@/lib/actions/billing-settings";
import type { BillingCycle } from "@/lib/db/schema";

export function BillingSettingsForm({
  studentId,
  defaultRateDollars,
  defaultCycle,
  defaultAnchor,
}: {
  studentId: string;
  defaultRateDollars: string;
  defaultCycle: BillingCycle;
  defaultAnchor: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rate, setRate] = useState(defaultRateDollars);
  const [cycle, setCycle] = useState<BillingCycle>(defaultCycle);
  const [anchor, setAnchor] = useState(defaultAnchor);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateBilling(
        studentId,
        parseFloat(rate),
        cycle,
        anchor,
      );
      if (res.ok) {
        toast.success("Billing settings saved");
        router.refresh();
      } else {
        toast.error("Couldn't save settings");
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="mt-8 rounded-2xl border border-brand-mist bg-white p-5"
    >
      <h2 className="text-sm font-medium text-brand-plum">Billing settings</h2>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="text-xs text-brand-ink/60">
          Rate per lesson
          <div className="mt-1 flex items-center rounded-lg border border-brand-mist px-2">
            <span className="text-sm text-brand-ink/50">$</span>
            <input
              type="number"
              step="1"
              min="0"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="80"
              className="w-20 bg-transparent px-1 py-1.5 text-sm text-brand-plum focus:outline-none"
            />
          </div>
        </label>
        <label className="text-xs text-brand-ink/60">
          Cycle
          <select
            value={cycle}
            onChange={(e) => setCycle(e.target.value as BillingCycle)}
            className="mt-1 block rounded-lg border border-brand-mist bg-white px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
          >
            {BILLING_CYCLES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-brand-ink/60">
          Start date
          <input
            type="date"
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
            className="mt-1 block rounded-lg border border-brand-mist bg-white px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-brand-plum px-4 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid disabled:opacity-50"
        >
          Save
        </button>
      </div>
      <p className="mt-3 text-xs text-brand-ink/45">
        Cycles are counted from the start date. Fees are billed in arrears and
        due at the end of each cycle.
      </p>
    </form>
  );
}
