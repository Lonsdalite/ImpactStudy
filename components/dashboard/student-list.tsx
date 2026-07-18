"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SearchInput } from "@/components/dashboard/search-input";

export interface StudentListRow {
  id: string;
  name: string;
  yearLevel: string;
  /** Parent view only: pre-formatted balance line, or null for staff. */
  balanceLabel: string | null;
  settled: boolean;
}

/**
 * The roster list + an optional instant name filter. The page stays a server
 * component and hands the already-fetched rows in; filtering is pure client
 * `useState` over data that's already in the browser — no round-trips. Matching
 * is word-prefix on the name (case-insensitive): "a" surfaces Aisha and Amara,
 * and a surname prefix like "car" still finds Ben Carter — but a stray "a"
 * mid-word (Martins) doesn't, which matches how people expect a name search to
 * read.
 */
export function StudentList({
  rows,
  showSearch,
}: {
  rows: StudentListRow[];
  showSearch: boolean;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? rows.filter((r) =>
            r.name
              .toLowerCase()
              .split(/\s+/)
              .some((word) => word.startsWith(q)),
          )
        : rows,
    [rows, q],
  );

  return (
    <div className="mt-8">
      {showSearch ? (
        <div className="mb-3">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search students"
            label="Search students by name"
          />
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-brand-mist bg-white px-5 py-6 text-center text-sm text-brand-ink/55">
          No students match &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-brand-mist bg-white">
          <ul className="divide-y divide-brand-mist">
            {filtered.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/dashboard/students/${s.id}`}
                  className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-brand-plum/[0.03]"
                >
                  <span className="font-medium text-brand-plum">{s.name}</span>
                  <span className="flex items-center gap-4">
                    {s.balanceLabel ? (
                      <span
                        className={
                          s.settled
                            ? "text-xs text-brand-sage"
                            : "text-xs text-brand-ink/60"
                        }
                      >
                        {s.balanceLabel}
                      </span>
                    ) : null}
                    <span className="rounded-full bg-brand-sage/15 px-3 py-1 text-xs font-medium text-brand-plum">
                      {s.yearLevel}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
