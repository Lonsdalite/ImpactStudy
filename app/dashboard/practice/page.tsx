import { EmptyState } from "@/components/dashboard/empty-state";

export const metadata = {
  title: "Practice",
};

export default function PracticePage() {
  return (
    <main className="flex-1 px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-display text-3xl tracking-tight text-brand-plum sm:text-4xl">
          Practice
        </h1>
        <p className="mt-2 text-sm text-brand-ink/65">
          Adaptive daily practice, tuned to each student&apos;s weakest concepts.
        </p>
        <div className="mt-10">
          <EmptyState
            title="No practice yet"
            body="Fresh questions generated daily in your tutor's voice, aimed at the concepts each student finds hardest."
            hint="Coming soon"
          />
        </div>
      </div>
    </main>
  );
}
