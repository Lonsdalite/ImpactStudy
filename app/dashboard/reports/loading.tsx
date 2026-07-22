import {
  SkeletonHeader,
  SkeletonPage,
  SkeletonRows,
} from "@/components/dashboard/skeleton";

export default function ReportsLoading() {
  return (
    <SkeletonPage srLabel="Loading reports">
      <SkeletonHeader />
      <SkeletonRows count={4} />
    </SkeletonPage>
  );
}
