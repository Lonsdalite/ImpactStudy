"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BILLING_CYCLES } from "@/lib/billing";
import { createStudent } from "@/lib/actions/students";
import type { BillingCycle } from "@/lib/db/schema";

export function AddStudentForm({ today }: { today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [rate, setRate] = useState("");
  const [cycle, setCycle] = useState<BillingCycle>("weekly");
  const [anchor, setAnchor] = useState(today);

  function reset() {
    setFirstName("");
    setLastName("");
    setYearLevel("");
    setRate("");
    setCycle("weekly");
    setAnchor(today);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim()) {
      toast.error("First name is required");
      return;
    }
    startTransition(async () => {
      const res = await createStudent({
        firstName,
        lastName,
        yearLevel,
        rateDollars: parseFloat(rate),
        cycle,
        anchor,
      });
      if (res.ok) {
        toast.success(`Added ${firstName.trim()}`);
        reset();
        setOpen(false);
        router.refresh();
      } else {
        toast.error("Couldn't add student");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-brand-plum px-5 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid"
      >
        Add student
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-brand-mist bg-white p-5"
    >
      <div className="flex flex-wrap gap-4">
        <label className="text-xs text-brand-ink/60">
          First name
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoFocus
            className="mt-1 block w-36 rounded-lg border border-brand-mist px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
          />
        </label>
        <label className="text-xs text-brand-ink/60">
          Last name
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="mt-1 block w-36 rounded-lg border border-brand-mist px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
          />
        </label>
        <label className="text-xs text-brand-ink/60">
          Year
          <input
            value={yearLevel}
            onChange={(e) => setYearLevel(e.target.value)}
            placeholder="Y6"
            className="mt-1 block w-20 rounded-lg border border-brand-mist px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
          />
        </label>
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
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-brand-plum px-4 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid disabled:opacity-50"
        >
          Add student
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="text-sm text-brand-plum-mid hover:underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
