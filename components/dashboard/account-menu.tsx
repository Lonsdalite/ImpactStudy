"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

/**
 * One account control, top-right on every dashboard surface (mobile top bar +
 * desktop sidebar header). Replaces the two ad-hoc "Sign out" links so the
 * sign-out is always reachable and never below the fold on a short window.
 *
 * A round initial-avatar button opens a dropdown holding: the signed-in email,
 * "Switch practice" (only when the user belongs to more than one), and "Sign
 * out". Sign-out stays a POST to /auth/sign-out — it's a mutation, not a GET
 * link. Keyboard-accessible (Escape closes, focus returns to the trigger) and
 * closes on outside-click.
 */
export function AccountMenu({
  userEmail,
  canSwitch,
}: {
  userEmail: string;
  canSwitch: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // The first letter of the email is a good-enough avatar. Fall back to a dot
  // rather than render an empty circle if the email is somehow blank.
  const initial = (userEmail.trim()[0] ?? "•").toUpperCase();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Account menu"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-plum text-sm font-medium text-brand-cream transition-colors hover:bg-brand-plum-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-plum-mid focus-visible:ring-offset-2 focus-visible:ring-offset-brand-cream"
      >
        <span aria-hidden="true">{initial}</span>
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-60 overflow-hidden rounded-2xl border border-brand-mist bg-white shadow-lg shadow-brand-plum/10"
        >
          <div className="border-b border-brand-mist px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-brand-ink/45">
              Signed in as
            </p>
            <p className="mt-0.5 truncate text-sm text-brand-ink/80" title={userEmail}>
              {userEmail}
            </p>
          </div>

          {canSwitch ? (
            <Link
              href="/tenant-select"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-[44px] items-center px-4 text-sm text-brand-ink/80 transition-colors hover:bg-brand-plum/[0.05] hover:text-brand-plum"
            >
              Switch practice
            </Link>
          ) : null}

          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              role="menuitem"
              className="flex min-h-[44px] w-full items-center px-4 text-left text-sm text-brand-plum-mid transition-colors hover:bg-brand-plum/[0.05] hover:text-brand-plum"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
