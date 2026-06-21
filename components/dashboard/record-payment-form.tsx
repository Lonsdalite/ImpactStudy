"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatMoney } from "@/lib/billing";
import { recordPayment, deletePayment } from "@/lib/actions/payments";
import type { PaymentMethod } from "@/lib/db/schema";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "payid", label: "PayID" },
  { value: "transfer", label: "Transfer" },
  { value: "other", label: "Other" },
];

export function RecordPaymentForm({
  studentId,
  studentName,
  defaultAmountCents,
}: {
  studentId: string;
  studentName: string;
  defaultAmountCents: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [amount, setAmount] = useState(
    defaultAmountCents > 0 ? (defaultAmountCents / 100).toFixed(2) : "",
  );
  const [method, setMethod] = useState<PaymentMethod>("cash");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      toast.error("Enter an amount");
      return;
    }
    startTransition(async () => {
      const res = await recordPayment(studentId, cents, method);
      if (!res.ok) {
        toast.error("Couldn't record payment");
        return;
      }
      toast.success(`Recorded ${formatMoney(cents)} · ${studentName}`, {
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              if (res.paymentId) await deletePayment(res.paymentId);
              router.refresh();
              toast("Payment removed");
            }),
        },
      });
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 flex flex-wrap items-center gap-2 border-t border-brand-mist pt-4"
    >
      <span className="text-xs text-brand-ink/55">Record</span>
      <div className="flex items-center rounded-lg border border-brand-mist px-2">
        <span className="text-sm text-brand-ink/50">$</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-24 bg-transparent px-1 py-1.5 text-sm text-brand-plum focus:outline-none"
        />
      </div>
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        className="rounded-lg border border-brand-mist bg-white px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
      >
        {METHODS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-brand-plum px-4 py-1.5 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid disabled:opacity-50"
      >
        Received
      </button>
    </form>
  );
}
