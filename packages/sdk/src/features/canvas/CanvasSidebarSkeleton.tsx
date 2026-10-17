import { Skeleton } from "@camox/ui/skeleton";

import { PageSidebarSkeleton } from "../preview/components/PageSidebarSkeleton";
import { CMS_SIDEBAR_WIDTH } from "../preview/previewConstants";

/**
 * Stands in for the Canvas sidebar of a selected Page while the Canvas loads, in the
 * layout of `CanvasItemSidebar`, so the page beside it doesn't shift once the Canvas shows.
 */
export function CanvasSidebarSkeleton({ derived = false }: { derived?: boolean }) {
  return (
    <aside
      data-canvas-sidebar-skeleton
      className="bg-background relative flex shrink-0 flex-col border-r-2"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      <header className="flex min-w-0 items-center gap-1 border-b-2 p-2">
        <Skeleton className="size-8" />
        <Skeleton className="ml-1 h-4 w-28" />
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <PageSidebarSkeleton derived={derived} />
      </div>
    </aside>
  );
}
