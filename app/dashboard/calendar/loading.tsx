import { Skeleton, SkeletonHeader, SkeletonPage } from "@/components/dashboard/skeleton";

/** Week grid: nav bar, then seven day columns. */
export default function CalendarLoading() {
  return (
    <SkeletonPage srLabel="Loading calendar" maxWidth="max-w-5xl">
      <SkeletonHeader />
      <Skeleton className="mt-6 h-14 w-full rounded-xl" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-brand-mist bg-white p-3"
          >
            <Skeleton className="h-3 w-12" />
            <Skeleton className="mt-3 h-16 w-full" />
            <Skeleton className="mt-2 h-16 w-full" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
