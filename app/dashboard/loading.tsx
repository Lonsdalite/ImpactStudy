import {
  SkeletonHeader,
  SkeletonPage,
  SkeletonRows,
  SkeletonTiles,
} from "@/components/dashboard/skeleton";

/**
 * Fallback loading state for the whole dashboard segment.
 *
 * This one boundary is what makes EVERY navigation under /dashboard paint
 * immediately — the sidebar is part of the layout and is preserved, so only the
 * content column swaps to a skeleton while the page's queries run. Routes with a
 * distinctly different shape override it with their own loading.tsx.
 */
export default function DashboardLoading() {
  return (
    <SkeletonPage srLabel="Loading your practice">
      <SkeletonHeader />
      <SkeletonTiles />
      <SkeletonRows count={3} />
    </SkeletonPage>
  );
}
