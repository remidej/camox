import { Skeleton } from "@camox/ui/skeleton";

import { PageSidebarSkeleton } from "../preview/components/PageSidebarSkeleton";
import { CMS_SIDEBAR_WIDTH } from "../preview/previewConstants";

/**
 * Stands in for the Canvas sidebar while the Canvas loads, so the page beside it
 * doesn't shift once the Canvas shows. For a selected Page, it takes the layout of
 * `CanvasItemSidebar`. Without one, it is empty but just as wide, so selecting and
 * deselecting on the Canvas never resizes the page frame's place under it.
 */
export function CanvasSidebarSkeleton({
  page = true,
  derived = false,
}: {
  /** Whether it stands in for a selected Page's sidebar. */
  page?: boolean;
  derived?: boolean;
}) {
  return (
    <aside
      data-canvas-sidebar-skeleton
      className="bg-background relative flex shrink-0 flex-col border-r-2"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      {page && (
        <>
          <header className="flex min-w-0 items-center gap-1 border-b-2 p-2">
            <Skeleton className="size-8" />
            <Skeleton className="ml-1 h-4 w-28" />
          </header>
          <div className="flex min-h-0 flex-1 flex-col">
            <PageSidebarSkeleton derived={derived} />
          </div>
        </>
      )}
    </aside>
  );
}
