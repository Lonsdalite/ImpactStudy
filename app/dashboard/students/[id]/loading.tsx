import {
  Skeleton,
  SkeletonPage,
  SkeletonRows,
} from "@/components/dashboard/skeleton";

/**
 * The student record opens with a name + the billed/paid/outstanding tiles, then
 * a tab strip. Mirroring that shape matters here more than elsewhere: this is
 * the deepest page in the app and the one Fatima lands on most from a link.
 */
export default function StudentDetailLoading() {
  return (
    <SkeletonPage srLabel="Loading student record" maxWidth="max-w-5xl">
      <Skeleton className="h-3 w-24" />
      <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
        <div>
          <Skeleton className="h-9 w-52" />
          <Skeleton className="mt-3 h-4 w-64" />
        </div>
        <div className="flex gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-brand-mist bg-white px-6 py-4"
            >
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-6 w-24" />
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="mt-8 h-14 w-full rounded-full" />
      <SkeletonRows count={2} />
    </SkeletonPage>
  );
}
