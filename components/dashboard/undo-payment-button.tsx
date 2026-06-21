"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deletePayment } from "@/lib/actions/payments";

export function UndoPaymentButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await deletePayment(paymentId);
          if (res.ok) {
            toast("Payment removed");
            router.refresh();
          } else {
            toast.error("Couldn't remove payment");
          }
        })
      }
      className="text-xs text-brand-ink/40 underline-offset-2 hover:text-brand-plum hover:underline disabled:opacity-50"
    >
      Undo
    </button>
  );
}
