import { Skeleton, SkeletonHeader, SkeletonPage } from "@/components/dashboard/skeleton";

/** Morning board: columns of assignment cards. */
export default function HomeworkLoading() {
  return (
    <SkeletonPage srLabel="Loading homework" maxWidth="max-w-5xl">
      <SkeletonHeader />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-brand-mist bg-white p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-12 w-full" />
            <Skeleton className="mt-2 h-12 w-full" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
