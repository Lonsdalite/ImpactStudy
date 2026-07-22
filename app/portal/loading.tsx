import {
  SkeletonHeader,
  SkeletonPage,
  SkeletonRows,
} from "@/components/dashboard/skeleton";

/** The student portal — same reasoning as the dashboard, on a slower device. */
export default function PortalLoading() {
  return (
    <SkeletonPage srLabel="Loading your homework" maxWidth="max-w-3xl">
      <SkeletonHeader />
      <SkeletonRows count={3} />
    </SkeletonPage>
  );
}
