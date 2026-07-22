import {
  SkeletonHeader,
  SkeletonPage,
  SkeletonRows,
  SkeletonTiles,
} from "@/components/dashboard/skeleton";

export default function BillingLoading() {
  return (
    <SkeletonPage srLabel="Loading billing">
      <SkeletonHeader />
      <SkeletonTiles count={2} />
      <SkeletonRows count={4} />
    </SkeletonPage>
  );
}
