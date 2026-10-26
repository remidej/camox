import { SidebarStack, SidebarStackView } from "../../preview/components/SidebarStack";
import { CanvasInspectorBody, CanvasInspectorHeaderSkeleton } from "./CanvasInspector";
import { CanvasViewHeader } from "./CanvasViewHeader";
import { ContentSidebarFrame } from "./ContentSidebarFrame";
import { CuratedPageSkeleton, LayoutPageSkeleton } from "./PageInspectorSkeleton";

/**
 * Stands in for the Content Sidebar while the Canvas loads, where the sidebar will show. For a
 * selected Page, it takes the Canvas Inspector's layout. Without one, it is empty.
 */
export function ContentSidebarSkeleton({
  page = true,
  layoutPage = false,
}: {
  /** Whether it stands in for a selected Page's sidebar. */
  page?: boolean;
  layoutPage?: boolean;
}) {
  return (
    <ContentSidebarFrame data-content-sidebar-skeleton>
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
    </ContentSidebarFrame>
  );
}
