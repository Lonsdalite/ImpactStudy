import { redirect } from "next/navigation";
import Link from "next/link";
import { resolveActiveTenant } from "@/lib/tenant";
import { loadCalendarWeek } from "@/lib/calendar-data";
import {
  computeWeekOccurrences,
  dayLabel,
  sydneyNow,
  weekDates,
  weekStart,
  addDaysIso,
} from "@/lib/calendar";
import {
  WeeklyCalendar,
  type CalendarStudent,
} from "@/components/dashboard/weekly-calendar";

export const metadata = { title: "Calendar" };

function mondayLabel(mondayIso: string): string {
  const sundayIso = addDaysIso(mondayIso, 6);
  const [ys, ms, ds] = mondayIso.split("-").map(Number);
  const [, me, de] = sundayIso.split("-").map(Number);
  const start = new Date(Date.UTC(ys, ms - 1, ds)).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const [ye] = sundayIso.split("-").map(Number);
  const end = new Date(Date.UTC(ye, me - 1, de)).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${start} – ${end}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; student?: string }>;
}) {
  const result = await resolveActiveTenant();
  if (result.status !== "ok") {
    redirect(result.status === "none" ? "/login" : "/tenant-select");
  }
  const { tenant } = result;
  const isStaff = ["owner", "admin", "tutor"].includes(tenant.role);
  if (!isStaff) {
    return (
      <main className="flex-1 px-6 py-10 md:px-10">
        <div className="mx-auto max-w-5xl">
          <h1 className="font-display text-3xl tracking-tight text-brand-plum">
            Calendar
          </h1>
          <p className="mt-3 text-sm text-brand-ink/65">
            The weekly calendar is for tutors and admins.
          </p>
        </div>
      </main>
    );
  }

  const params = await searchParams;
  const today = sydneyNow().date;
  const monday = weekStart(params.week ?? today);
  const dates = weekDates(monday);

  const data = await loadCalendarWeek(tenant.tenantId, dates);
  const now = sydneyNow();
  const occurrences = computeWeekOccurrences({ ...data, dates, now });

  // Student filter options — everyone with a slot or lesson this week.
  const studentMap = new Map<string, string>();
  for (const o of occurrences) studentMap.set(o.studentId, o.studentName);
  const students: CalendarStudent[] = [...studentMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const prevWeek = addDaysIso(monday, -7);
  const nextWeek = addDaysIso(monday, 7);
  const thisMonday = weekStart(today);

  return (
    <main className="flex-1 px-6 py-10 md:px-10">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-plum-mid">
          {tenant.displayName}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-brand-plum sm:text-4xl">
          Calendar
        </h1>
        <p className="mt-2 text-sm text-brand-ink/65">
          Your teaching week. Mark the day (or the whole week) once it&apos;s
          happened — fees post automatically at hours × rate. Reschedule a single
          class from the day drawer; change recurring days from the student&apos;s
          enrollment.
        </p>

        {/* Week nav */}
        <div className="mt-6 flex items-center justify-between rounded-xl border border-brand-mist bg-white px-4 py-3">
          <Link
            href={`/dashboard/calendar?week=${prevWeek}`}
            className="rounded-lg px-3 py-1.5 text-sm text-brand-plum-mid hover:bg-brand-plum/[0.05]"
          >
            ← Prev
          </Link>
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm font-medium text-brand-plum">
              {mondayLabel(monday)}
            </span>
            {monday !== thisMonday ? (
              <Link
                href="/dashboard/calendar"
                className="text-xs text-brand-plum-mid hover:underline"
              >
                This week
              </Link>
            ) : (
              <span className="text-xs text-brand-ink/45">This week</span>
            )}
          </div>
          <Link
            href={`/dashboard/calendar?week=${nextWeek}`}
            className="rounded-lg px-3 py-1.5 text-sm text-brand-plum-mid hover:bg-brand-plum/[0.05]"
          >
            Next →
          </Link>
        </div>

        <WeeklyCalendar
          monday={monday}
          dates={dates}
          today={now.date}
          occurrences={occurrences}
          students={students}
          dayLabels={dates.map((d) => dayLabel(d))}
        />
      </div>
    </main>
  );
}
