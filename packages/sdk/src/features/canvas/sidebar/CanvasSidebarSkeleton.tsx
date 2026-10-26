import { SidebarStack, SidebarStackView } from "../../preview/components/SidebarStack";
import { CanvasInspectorBody, CanvasInspectorHeaderSkeleton } from "./CanvasInspector";
import { CanvasSidebarFrame } from "./CanvasSidebarFrame";
import { CanvasViewHeader } from "./CanvasViewHeader";
import { CuratedPageSkeleton, LayoutPageSkeleton } from "./PageInspectorSkeleton";

/**
 * Stands in for the Canvas sidebar while the Canvas loads, where the sidebar will show. For a
 * selected Page, it takes the Canvas Inspector's layout. Without one, it is empty.
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
        // In the stack's layout, so nothing shifts once it shows.
        <SidebarStack>
          <CanvasViewHeader covered />
          <CanvasInspectorHeaderSkeleton />
          <CanvasInspectorBody>
            <SidebarStackView depth={1} className="flex flex-col">
              {layoutPage ? <LayoutPageSkeleton /> : <CuratedPageSkeleton />}
            </SidebarStackView>
          </CanvasInspectorBody>
        </SidebarStack>
      )}
    </CanvasSidebarFrame>
  );
}
