import {
  SkeletonHeader,
  SkeletonPage,
  SkeletonRows,
} from "@/components/dashboard/skeleton";

export default function AttendanceLoading() {
  return (
    <SkeletonPage srLabel="Loading attendance">
      <SkeletonHeader />
      <SkeletonRows count={5} />
    </SkeletonPage>
  );
}
