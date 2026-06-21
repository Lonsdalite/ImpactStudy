/**
 * Empty-state card for dashboard surfaces that aren't populated yet.
 */
export function EmptyState({
  title,
  body,
  hint,
}: {
  title: string;
  body: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-brand-mist bg-white/50 p-12 text-center">
      <h2 className="font-display text-xl text-brand-plum">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-brand-ink/60">
        {body}
      </p>
      {hint ? (
        <p className="mt-5 text-xs font-medium uppercase tracking-[0.14em] text-brand-plum-mid">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
