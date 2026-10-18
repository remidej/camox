import { CanvasInspectorBody, CanvasInspectorHeaderSkeleton } from "./CanvasInspector";
import { CanvasSidebarFrame } from "./CanvasSidebarFrame";
import { CuratedPageSkeleton, LayoutPageSkeleton } from "./PageInspectorSkeleton";

/**
 * Stands in for the Canvas sidebar while the Canvas loads, so the page beside it
 * doesn't shift once the Canvas shows. For a selected Page, it takes the Canvas
 * Inspector's layout. Without one, it is empty but just as wide, so selecting and
 * deselecting on the Canvas never resizes the page frame's place under it.
 */
export function CanvasSidebarSkeleton({
  page = true,
  layoutPage = false,
}: {
  /** Whether it stands in for a selected Page's sidebar. */
  page?: boolean;
  layoutPage?: boolean;
}) {
  return (
    <CanvasSidebarFrame data-canvas-sidebar-skeleton>
      {page && (
        <>
          <CanvasInspectorHeaderSkeleton />
          <CanvasInspectorBody>
            {layoutPage ? <LayoutPageSkeleton /> : <CuratedPageSkeleton />}
          </CanvasInspectorBody>
        </>
      )}
    </CanvasSidebarFrame>
  );
}
