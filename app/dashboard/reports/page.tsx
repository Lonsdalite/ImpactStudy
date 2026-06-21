import { EmptyState } from "@/components/dashboard/empty-state";

export const metadata = {
  title: "Reports",
};

export default function ReportsPage() {
  return (
    <main className="flex-1 px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-display text-3xl tracking-tight text-brand-plum sm:text-4xl">
          Reports
        </h1>
        <p className="mt-2 text-sm text-brand-ink/65">
          The parent heartbeat: daily micro-wins and weekly progress.
        </p>
        <div className="mt-10">
          <EmptyState
            title="No reports yet"
            body="Daily micro-win cards and weekly progress summaries, written in your tutor's voice and sent to parents automatically."
            hint="Coming soon"
          />
        </div>
      </div>
    </main>
  );
}
