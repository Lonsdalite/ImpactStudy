import {
  SkeletonHeader,
  SkeletonPage,
  SkeletonRows,
} from "@/components/dashboard/skeleton";

export default function StudentsLoading() {
  return (
    <SkeletonPage srLabel="Loading students">
      <SkeletonHeader />
      <SkeletonRows count={5} />
    </SkeletonPage>
  );
}
