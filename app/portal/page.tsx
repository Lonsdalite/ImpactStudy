import { redirect } from "next/navigation";
import Link from "next/link";
import { requireStudent } from "@/lib/portal.server";
import { createClient } from "@/lib/supabase/server";
import { shortDate, todaySydney } from "@/lib/billing";
import { diligence, diligenceLine } from "@/lib/diligence";
import type { AssignmentStatus } from "@/lib/db/schema";

export const metadata = { title: "My homework" };

/**
 * The assignments INBOX (Slice D — doc 26 §2D). The portal's front door and, for
 * the pilot, very nearly the whole thing: assigned / due / status, with the
 * returned work underneath.
 *
 * Split into "To do" and "Marked" rather than showing the raw four-state pipeline
 * (assigned → submitted → corrected → returned). That pipeline is FATIMA's mental
 * model — a child doesn't care whether their work is "submitted" or "corrected";
 * both mean "handed in, nothing for me to do". Same data, a different lens (the
 * two-lens pattern, as with C's board and B's calendar).
 */

interface AssignmentRow {
  id: string;
  title: string;
  status: AssignmentStatus;
  due_date: string | null;
  created_at: string;
  note: string | null;
  worksheet_id: string | null;
  subject: { name: string } | null;
}

/** What the STUDENT sees, in their words. */
const STUDENT_STATUS: Record<AssignmentStatus, string> = {
  assigned: "To do",
  submitted: "Handed in",
  corrected: "Handed in",
  returned: "Marked",
  archived: "Archived",
};

function dueLabel(due: string | null, today: string): { text: string; late: boolean } | null {
  if (!due) return null;
  if (due < today) return { text: `Was due ${shortDate(due)}`, late: true };
  if (due === today) return { text: "Due today", late: false };
  return { text: `Due ${shortDate(due)}`, late: false };
}

export default async function PortalInboxPage() {
  const me = await requireStudent();
  if (!me) redirect("/dashboard");

  const today = todaySydney();
  const supabase = await createClient();

  // RLS does the scoping (assignments_select_staff_or_parent's student arm), but
  // filter by student_id anyway — the same defence-in-depth discipline the staff
  // paths use, and it keeps the query honest if a policy ever widens.
  const { data } = await supabase
    .from("assignments")
    .select(
      "id, title, status, due_date, created_at, note, worksheet_id, subject:subjects(name)",
    )
    .eq("student_id", me.studentId)
    .neq("status", "archived")
    .order("order_index", { ascending: true });
  const assignments = (data ?? []) as unknown as AssignmentRow[];

  const todo = assignments.filter((a) => a.status !== "returned");
  const marked = assignments.filter((a) => a.status === "returned");

  // Same effort count their parent sees — no reason to hide it from the person
  // who did the work, and it makes the number feel like a shared fact rather
  // than something reported behind their back.
  const effort = diligence(
    assignments.map((a) => ({ createdAt: a.created_at, status: a.status })),
    today,
  );
  const effortLine = diligenceLine(effort, "You");

  return (
    <main className="flex-1 px-5 py-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-3xl tracking-tight text-brand-plum">
          Hi {me.firstName}
        </h1>
        <p className="mt-2 text-sm text-brand-ink/65">
          {todo.length === 0
            ? "Nothing to hand in right now."
            : `You have ${todo.filter((a) => a.status === "assigned").length} thing${
                todo.filter((a) => a.status === "assigned").length === 1 ? "" : "s"
              } to do.`}
        </p>
        {effortLine ? (
          <p className="mt-1 text-xs text-brand-ink/50">{effortLine}</p>
        ) : null}

        {assignments.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-brand-mist bg-white px-5 py-10 text-center">
            <p className="font-display text-xl text-brand-plum">
              No homework yet
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-brand-ink/60">
              When your tutor sets you a worksheet, it&apos;ll show up here. You
              can download it, then upload a photo of your work when you&apos;re
              done.
            </p>
          </div>
        ) : null}

        {todo.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-sm font-medium text-brand-plum">To do</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {todo.map((a) => (
                <AssignmentCard key={a.id} assignment={a} today={today} />
              ))}
            </ul>
          </section>
        ) : null}

        {marked.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-sm font-medium text-brand-plum">Marked</h2>
            <p className="mt-1 text-xs text-brand-ink/50">
              Your tutor has looked at these. Tap to read the feedback.
            </p>
            <ul className="mt-3 flex flex-col gap-3">
              {marked.map((a) => (
                <AssignmentCard key={a.id} assignment={a} today={today} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function AssignmentCard({
  assignment: a,
  today,
}: {
  assignment: AssignmentRow;
  today: string;
}) {
  const due = dueLabel(a.due_date, today);
  const handedIn = a.status === "submitted" || a.status === "corrected";

  return (
    <li>
      {/* The whole card is the tap target — a phone-sized hit area, not a link
          buried in the corner (the C.5 mobile pass, verified at 390px). */}
      <Link
        href={`/portal/${a.id}`}
        className="flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-brand-mist bg-white px-5 py-4 transition-colors hover:border-brand-plum/30"
      >
        <div className="min-w-0">
          <p className="truncate font-medium text-brand-plum">{a.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-brand-ink/55">
            {a.subject?.name ? <span>{a.subject.name}</span> : null}
            {a.subject?.name && due ? <span aria-hidden>·</span> : null}
            {due ? (
              // Warn, never block (the standing UX rule): an overdue worksheet
              // is coloured, never barred from being handed in late.
              <span className={due.late ? "text-red-600" : undefined}>
                {due.text}
              </span>
            ) : null}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            a.status === "returned"
              ? "bg-brand-plum text-brand-cream"
              : handedIn
                ? "bg-brand-sage/20 text-brand-plum"
                : "bg-brand-gold/15 text-brand-plum"
          }`}
        >
          {STUDENT_STATUS[a.status]}
        </span>
      </Link>
    </li>
  );
}
