"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ENROLLMENT_MODES,
  blockAmountCents,
  defaultSessionMinutes,
  formatDuration,
  formatMoney,
  modeLabel,
} from "@/lib/billing";
import {
  createSubject,
  savePriceListItem,
  setPriceListItemActive,
  setSubjectActive,
} from "@/lib/actions/pricing";
import type { EnrollmentMode } from "@/lib/db/schema";

export interface SubjectItem {
  id: string;
  name: string;
  active: boolean;
}
export interface PriceItem {
  id: string;
  yearLevel: string;
  subjectId: string;
  subjectName: string;
  mode: EnrollmentMode;
  hourlyRateCents: number;
  defaultSessionMinutes: number;
  currency: string;
  active: boolean;
}

export function PricingManager({
  subjects,
  prices,
}: {
  subjects: SubjectItem[];
  prices: PriceItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // ----- subjects -----
  const [newSubject, setNewSubject] = useState("");

  function addSubject(e: React.FormEvent) {
    e.preventDefault();
    const name = newSubject.trim();
    if (!name) return;
    startTransition(async () => {
      const res = await createSubject(name);
      if (res.ok) {
        toast.success(`Added ${name}`);
        setNewSubject("");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't add subject");
      }
    });
  }

  function toggleSubject(id: string, next: boolean) {
    startTransition(async () => {
      const res = await setSubjectActive(id, next);
      if (res.ok) router.refresh();
      else toast.error("Couldn't update subject");
    });
  }

  // ----- add price row -----
  const activeSubjects = subjects.filter((s) => s.active);
  const [year, setYear] = useState("");
  const [subjectId, setSubjectId] = useState(activeSubjects[0]?.id ?? "");
  const [mode, setMode] = useState<EnrollmentMode>("one_to_one");
  const [rate, setRate] = useState("");
  const [minutes, setMinutes] = useState("");

  function addPrice(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await savePriceListItem({
        yearLevel: year,
        subjectId,
        mode,
        hourlyRateDollars: parseFloat(rate),
        sessionMinutes: minutes ? parseInt(minutes, 10) : undefined,
      });
      if (res.ok) {
        toast.success("Rate saved");
        setYear("");
        setRate("");
        setMinutes("");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't save rate");
      }
    });
  }

  const activePrices = prices.filter((p) => p.active);
  const inactivePrices = prices.filter((p) => !p.active);

  return (
    <div className="mt-8 flex flex-col gap-8">
      {/* Subjects */}
      <section className="rounded-2xl border border-brand-mist bg-white p-5">
        <h2 className="text-sm font-medium text-brand-plum">Subjects</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {subjects.length === 0 ? (
            <p className="text-xs text-brand-ink/55">No subjects yet.</p>
          ) : (
            subjects.map((s) => (
              <span
                key={s.id}
                className={
                  "inline-flex items-center gap-2 rounded-full py-1.5 pl-3 pr-2 text-xs font-medium " +
                  (s.active
                    ? "bg-brand-sage/15 text-brand-plum"
                    : "border border-brand-mist text-brand-ink/40")
                }
              >
                <span className={s.active ? "" : "line-through"}>{s.name}</span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => toggleSubject(s.id, !s.active)}
                  className="rounded-full px-1.5 text-[11px] text-brand-plum-mid hover:bg-white/60 hover:underline disabled:opacity-50"
                >
                  {s.active ? "Archive" : "Restore"}
                </button>
              </span>
            ))
          )}
        </div>
        <form onSubmit={addSubject} className="mt-4 flex items-end gap-2">
          <label className="text-xs text-brand-ink/60">
            New subject
            <input
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              placeholder="e.g. Biology"
              className="mt-1 block w-44 rounded-lg border border-brand-mist px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-brand-plum px-3 py-2 text-sm font-medium text-brand-cream hover:bg-brand-plum-mid disabled:opacity-50"
          >
            Add
          </button>
        </form>
      </section>

      {/* Price list */}
      <section className="rounded-2xl border border-brand-mist bg-white p-5">
        <h2 className="text-sm font-medium text-brand-plum">Price list</h2>
        <p className="mt-1 text-xs text-brand-ink/55">
          One rate per year level × subject × mode. Enrollments inherit the
          hourly rate and session length from here.
        </p>

        {activePrices.length === 0 ? (
          <p className="mt-4 text-sm text-brand-ink/60">No rates yet.</p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-brand-mist">
            <ul className="divide-y divide-brand-mist">
              {activePrices.map((p) => (
                <PriceRow
                  key={p.id}
                  price={p}
                  isPending={isPending}
                  onSaved={() => router.refresh()}
                  runToggle={(next) =>
                    startTransition(async () => {
                      const res = await setPriceListItemActive(p.id, next);
                      if (res.ok) router.refresh();
                      else toast.error("Couldn't update");
                    })
                  }
                />
              ))}
            </ul>
          </div>
        )}

        {/* Add a rate */}
        {activeSubjects.length === 0 ? (
          <p className="mt-4 text-xs text-brand-ink/55">
            Add a subject above first.
          </p>
        ) : (
          <form onSubmit={addPrice} className="mt-5 flex flex-wrap items-end gap-3">
            <label className="text-xs text-brand-ink/60">
              Year
              <input
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="Y6"
                className="mt-1 block w-16 rounded-lg border border-brand-mist px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
              />
            </label>
            <label className="text-xs text-brand-ink/60">
              Subject
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="mt-1 block rounded-lg border border-brand-mist bg-white px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
              >
                {activeSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-brand-ink/60">
              Mode
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as EnrollmentMode)}
                className="mt-1 block rounded-lg border border-brand-mist bg-white px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
              >
                {ENROLLMENT_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-brand-ink/60">
              $/hour
              <div className="mt-1 flex items-center rounded-lg border border-brand-mist px-2">
                <span className="text-sm text-brand-ink/50">$</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="60"
                  className="w-16 bg-transparent px-1 py-1.5 text-sm text-brand-plum focus:outline-none"
                />
              </div>
            </label>
            <label className="text-xs text-brand-ink/60">
              Session (min)
              <input
                type="number"
                step="15"
                min="0"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder={String(defaultSessionMinutes(mode))}
                className="mt-1 block w-24 rounded-lg border border-brand-mist px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-brand-plum px-4 py-2 text-sm font-medium text-brand-cream hover:bg-brand-plum-mid disabled:opacity-50"
            >
              Add rate
            </button>
          </form>
        )}
        <p className="mt-2 text-xs text-brand-ink/45">
          Leave session blank to use the mode default (1:1 → 60 min, group → 90
          min).
        </p>

        {inactivePrices.length > 0 ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-brand-plum-mid">
              {inactivePrices.length} archived rate
              {inactivePrices.length > 1 ? "s" : ""}
            </summary>
            <ul className="mt-2 divide-y divide-brand-mist rounded-xl border border-brand-mist">
              {inactivePrices.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <span className="text-brand-ink/60">
                    {p.yearLevel} · {p.subjectName} · {modeLabel(p.mode)}
                  </span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await setPriceListItemActive(p.id, true);
                        if (res.ok) router.refresh();
                      })
                    }
                    className="rounded-lg border border-brand-mist px-3 py-1.5 text-xs text-brand-ink/70 hover:border-brand-plum/30 disabled:opacity-50"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </div>
  );
}

/** A single price row with inline edit (rate + session length). */
function PriceRow({
  price,
  isPending,
  onSaved,
  runToggle,
}: {
  price: PriceItem;
  isPending: boolean;
  onSaved: () => void;
  runToggle: (next: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rate, setRate] = useState((price.hourlyRateCents / 100).toString());
  const [minutes, setMinutes] = useState(String(price.defaultSessionMinutes));
  const [saving, startSave] = useTransition();

  const perSession = blockAmountCents(
    price.defaultSessionMinutes,
    price.hourlyRateCents,
  );

  function save() {
    startSave(async () => {
      const res = await savePriceListItem({
        id: price.id,
        yearLevel: price.yearLevel,
        subjectId: price.subjectId,
        mode: price.mode,
        hourlyRateDollars: parseFloat(rate),
        sessionMinutes: parseInt(minutes, 10),
      });
      if (res.ok) {
        toast.success("Rate updated");
        setEditing(false);
        onSaved();
      } else {
        toast.error(res.error ?? "Couldn't save");
      }
    });
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-brand-plum">
            {price.yearLevel} · {price.subjectName}
            <span className="ml-2 rounded-full bg-brand-sage/15 px-2 py-0.5 text-[11px] font-medium text-brand-plum">
              {modeLabel(price.mode)}
            </span>
          </p>
          {!editing ? (
            <p className="mt-0.5 text-xs text-brand-ink/55">
              {formatMoney(price.hourlyRateCents, price.currency)}/hr ·{" "}
              {formatDuration(price.defaultSessionMinutes)} →{" "}
              {formatMoney(perSession, price.currency)}/session
            </p>
          ) : null}
        </div>
        {!editing ? (
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setEditing(true)}
              className="rounded-lg border border-brand-mist px-3 py-1.5 text-xs text-brand-ink/70 hover:border-brand-plum/30 disabled:opacity-50"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => runToggle(false)}
              className="rounded-lg border border-brand-mist px-3 py-1.5 text-xs text-brand-ink/70 hover:border-brand-plum/30 disabled:opacity-50"
            >
              Archive
            </button>
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-brand-ink/60">
            $/hour
            <div className="mt-1 flex items-center rounded-lg border border-brand-mist px-2">
              <span className="text-sm text-brand-ink/50">$</span>
              <input
                type="number"
                step="1"
                min="0"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="w-16 bg-transparent px-1 py-1.5 text-sm text-brand-plum focus:outline-none"
              />
            </div>
          </label>
          <label className="text-xs text-brand-ink/60">
            Session (min)
            <input
              type="number"
              step="15"
              min="0"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="mt-1 block w-24 rounded-lg border border-brand-mist px-2 py-1.5 text-sm text-brand-plum focus:outline-none"
            />
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="rounded-lg bg-brand-plum px-4 py-2 text-sm font-medium text-brand-cream hover:bg-brand-plum-mid disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setRate((price.hourlyRateCents / 100).toString());
              setMinutes(String(price.defaultSessionMinutes));
              setEditing(false);
            }}
            className="text-sm text-brand-plum-mid hover:underline"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </li>
  );
}
