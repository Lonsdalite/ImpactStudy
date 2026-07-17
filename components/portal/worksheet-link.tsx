"use client";

import { useState } from "react";
import { toast } from "sonner";
import { signedWorksheetUrlForStudent } from "@/lib/actions/portal";
import { Button } from "@/components/ui/button";

/**
 * "Open the worksheet" (Slice D).
 *
 * The URL is minted on TAP, not rendered into the page. Two reasons, both real:
 * signed URLs are short-lived (30 min), so one baked into a page a child left
 * open at breakfast would be dead by the time they tapped it; and the
 * assignment-gate check (doc 35b §5.4 — a join, not a path predicate) belongs on
 * the action, which is where a fresh URL comes from anyway.
 *
 * `_blank` + noopener: on a phone this hands the file to the OS viewer, which is
 * what "download/print it" means to a student with a printer at home.
 */
export function WorksheetLink({ worksheetId }: { worksheetId: string }) {
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    const res = await signedWorksheetUrlForStudent(worksheetId);
    setBusy(false);
    if (!res.ok || !res.url) {
      toast.error(res.error ?? "Couldn't open the worksheet.");
      return;
    }
    window.open(res.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-mist bg-white px-5 py-4">
      <div>
        <p className="text-sm font-medium text-brand-plum">Your worksheet</p>
        <p className="mt-0.5 text-xs text-brand-ink/55">
          Open it to read on screen, or print it out.
        </p>
      </div>
      <Button type="button" className="min-h-11" disabled={busy} onClick={open}>
        {busy ? "Opening…" : "Open worksheet"}
      </Button>
    </div>
  );
}
