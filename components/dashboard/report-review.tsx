"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  approveReport,
  draftWeeklyReports,
  editReport,
  sendReport,
} from "@/lib/actions/reports";
import { shortDate } from "@/lib/billing";
import type { ReportStatus } from "@/lib/db/schema";

export interface ReviewReport {
  id: string;
  studentName: string;
  status: ReportStatus;
  greeting: string;
  body: string;
  signoff: string;
  sentAt: string | null;
}

const STATUS_CHIP: Record<ReportStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-brand-gold/15 text-brand-plum" },
  approved: { label: "Approved", cls: "bg-brand-sage/20 text-brand-plum" },
  sent: { label: "Sent", cls: "bg-brand-plum text-brand-cream" },
};

export function ReportReview({
  periodLabel,
  reports,
}: {
  periodLabel: string;
  reports: ReviewReport[];
}) {
  const router = useRouter();
  const [isDrafting, startDraft] = useTransition();

  function draftAll() {
    startDraft(async () => {
      const res = await draftWeeklyReports();
      if (!res.ok || !res.summary) {
        toast.error(res.error ?? "Couldn't draft notes");
        return;
      }
      const { drafted, updated, skipped } = res.summary;
      toast.success(
        `Drafted ${drafted}${updated ? `, refreshed ${updated}` : ""}${
          skipped ? `, skipped ${skipped}` : ""
        }. Review and approve below.`,
      );
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-brand-plum">
            This week&apos;s notes
          </h2>
          <p className="mt-1 text-xs text-brand-ink/55">{periodLabel}</p>
        </div>
        <button
          type="button"
          onClick={draftAll}
          disabled={isDrafting}
          className="rounded-lg bg-brand-plum px-5 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid disabled:opacity-50"
        >
          {isDrafting ? "Drafting…" : "Draft this week's notes"}
        </button>
      </div>

      {reports.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-brand-mist bg-white/50 px-5 py-8 text-center text-sm text-brand-ink/55">
          No notes drafted for this week yet. Mark attendance and add a line on
          what you covered, then draft.
        </p>
      ) : (
        <ul className="mt-5 flex flex-col gap-4">
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} onChanged={() => router.refresh()} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportCard({
  report,
  onChanged,
}: {
  report: ReviewReport;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [greeting, setGreeting] = useState(report.greeting);
  const [body, setBody] = useState(report.body);
  const [signoff, setSignoff] = useState(report.signoff);
  const [isPending, startTransition] = useTransition();

  const chip = STATUS_CHIP[report.status];

  function save() {
    if (!body.trim()) {
      toast.error("The note can't be empty");
      return;
    }
    startTransition(async () => {
      const res = await editReport({ reportId: report.id, greeting, body, signoff });
      if (res.ok) {
        toast.success("Saved");
        setEditing(false);
        onChanged();
      } else {
        toast.error(res.error ?? "Couldn't save");
      }
    });
  }

  function approve() {
    startTransition(async () => {
      const res = await approveReport(report.id);
      if (res.ok) {
        toast.success("Approved");
        onChanged();
      } else {
        toast.error(res.error ?? "Couldn't approve");
      }
    });
  }

  function send() {
    startTransition(async () => {
      const res = await sendReport(report.id);
      if (res.ok) {
        toast.success(`Sent to ${report.studentName}'s parent`);
        onChanged();
      } else {
        toast.error(res.error ?? "Couldn't send");
      }
    });
  }

  async function copyNote() {
    const text = [greeting, body, signoff]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Note copied — paste it into WhatsApp");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  return (
    <li className="rounded-2xl border border-brand-mist bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-brand-plum">{report.studentName}</span>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${chip.cls}`}
        >
          {chip.label}
        </span>
      </div>

      {editing ? (
        <div className="mt-4 flex flex-col gap-2">
          <input
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            placeholder="Greeting"
            className="rounded-lg border border-brand-mist px-3 py-2 text-sm text-brand-ink/85 focus:border-brand-plum/30 focus:outline-none"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="rounded-lg border border-brand-mist px-3 py-2 text-sm leading-relaxed text-brand-ink/85 focus:border-brand-plum/30 focus:outline-none"
          />
          <input
            value={signoff}
            onChange={(e) => setSignoff(e.target.value)}
            placeholder="Sign-off"
            className="rounded-lg border border-brand-mist px-3 py-2 text-sm text-brand-ink/85 focus:border-brand-plum/30 focus:outline-none"
          />
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-brand-mist bg-brand-cream/40 p-4">
          {greeting ? (
            <p className="text-sm leading-relaxed text-brand-ink/85">{greeting}</p>
          ) : null}
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-brand-ink/85">
            {body}
          </p>
          {signoff ? (
            <p className="mt-2 text-sm leading-relaxed text-brand-ink/85">
              {signoff}
            </p>
          ) : null}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button
              type="button"
              onClick={save}
              disabled={isPending}
              className="rounded-lg bg-brand-plum px-4 py-1.5 text-xs font-medium text-brand-cream hover:bg-brand-plum-mid disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setGreeting(report.greeting);
                setBody(report.body);
                setSignoff(report.signoff);
                setEditing(false);
              }}
              className="rounded-lg border border-brand-mist px-4 py-1.5 text-xs font-medium text-brand-ink/70 hover:bg-brand-plum/[0.04]"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {report.status !== "sent" ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-lg border border-brand-mist px-4 py-1.5 text-xs font-medium text-brand-ink/70 hover:bg-brand-plum/[0.04]"
              >
                Edit
              </button>
            ) : null}
            {report.status === "draft" ? (
              <button
                type="button"
                onClick={approve}
                disabled={isPending}
                className="rounded-lg bg-brand-sage/20 px-4 py-1.5 text-xs font-medium text-brand-plum hover:bg-brand-sage/30 disabled:opacity-50"
              >
                Approve
              </button>
            ) : null}
            {report.status === "approved" ? (
              <button
                type="button"
                onClick={send}
                disabled={isPending}
                className="rounded-lg bg-brand-plum px-4 py-1.5 text-xs font-medium text-brand-cream hover:bg-brand-plum-mid disabled:opacity-50"
              >
                Send to parent
              </button>
            ) : null}
            <button
              type="button"
              onClick={copyNote}
              className="rounded-lg border border-brand-plum/30 px-4 py-1.5 text-xs font-medium text-brand-plum hover:bg-brand-plum/[0.06]"
            >
              Copy note
            </button>
            {report.status === "sent" && report.sentAt ? (
              <span className="ml-auto text-xs text-brand-ink/45">
                Sent {shortDate(report.sentAt.slice(0, 10))}
              </span>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}
