"use client";

import { useId } from "react";

/**
 * A small, reusable instant-filter input. Purely presentational — it owns no
 * list state; the parent holds the query and does the filtering, so the same
 * input styles the Students roster and the Worksheet library identically.
 * Slim, brand-styled, ≥44px tap target, with an accessible clear button.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Accessible name for screen readers; falls back to the placeholder. */
  label?: string;
}) {
  const id = useId();
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label ?? placeholder ?? "Search"}
      </label>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink/40"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        id={id}
        type="text"
        inputMode="search"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-[44px] w-full rounded-full border border-brand-mist bg-white pl-10 pr-11 text-sm text-brand-plum placeholder:text-brand-ink/40 focus:border-brand-plum/30 focus:outline-none focus:ring-2 focus:ring-brand-plum-mid/25"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-brand-ink/45 transition-colors hover:bg-brand-plum/[0.06] hover:text-brand-plum"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
