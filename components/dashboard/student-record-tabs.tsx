"use client";

import { useState, type ReactNode } from "react";

export interface RecordTab {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Segments a student record into tabs — one concern per tab — instead of one
 * endless scroll. The page stays a server component: it fetches every section
 * as before and passes the already-rendered panels in as `content`, so there
 * are no extra round-trips and every action inside a panel keeps working.
 *
 * Tab state is pure client `useState`. Deep-linkability is preserved cheaply:
 * the page reads `?tab=` on the server and passes `initialTab`; switching tabs
 * rewrites the query with history.replaceState (no navigation, no re-fetch) so
 * a refresh lands on the same tab.
 */
export function StudentRecordTabs({
  tabs,
  initialTab,
}: {
  tabs: RecordTab[];
  initialTab?: string;
}) {
  const firstValid =
    tabs.find((t) => t.id === initialTab)?.id ?? tabs[0]?.id ?? "";
  const [active, setActive] = useState(firstValid);

  function select(id: string) {
    setActive(id);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", id);
      window.history.replaceState(null, "", url.toString());
    }
  }

  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className="mt-6">
      {/* Segmented control. The strip scrolls WITHIN itself on a narrow phone —
          the page body never scrolls sideways. Tap targets are ≥44px. */}
      <div
        role="tablist"
        aria-label="Student record sections"
        className="-mx-1 flex gap-1 overflow-x-auto overscroll-x-contain rounded-full border border-brand-mist bg-white p-1"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              onClick={() => select(tab.id)}
              className={
                "flex min-h-[44px] shrink-0 items-center rounded-full px-4 text-sm font-medium transition-colors " +
                (selected
                  ? "bg-brand-plum text-brand-cream"
                  : "text-brand-ink/70 hover:bg-brand-plum/[0.05] hover:text-brand-plum")
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab ? (
        <div
          role="tabpanel"
          id={`panel-${activeTab.id}`}
          aria-labelledby={`tab-${activeTab.id}`}
        >
          {activeTab.content}
        </div>
      ) : null}
    </div>
  );
}
