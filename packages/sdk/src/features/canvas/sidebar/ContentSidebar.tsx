import type * as React from "react";

import { CreatePageModal } from "../../preview/components/CreatePageModal";
import { SidebarStack, SidebarStackView } from "../../preview/components/SidebarStack";
import type { EditingOwner } from "../../preview/previewStore";
import type { CanvasPage } from "../canvasPages";
import { CanvasNavigator } from "./CanvasNavigator";
import { CanvasViewHeader } from "./CanvasViewHeader";
import { ContentSidebarFrame } from "./ContentSidebarFrame";
import { PageInspector } from "./PageInspector";

/**
 * The sidebar beside the Canvas, a stack of views: the Canvas's own, which shows the Canvas
 * Navigator, then the Canvas Inspector of the selected Page laid over it, if any.
 */
export function ContentSidebar({
  page,
  navigator,
  onShowWholeCanvas,
  owner = null,
  runtimeBasePath,
}: {
  page: CanvasPage | undefined;
  /** Shown without a selection, on the Canvas itself. */
  navigator: React.ComponentProps<typeof CanvasNavigator>;
  /** Leaves the selection for the whole Canvas, where the navigator shows. */
  onShowWholeCanvas: () => void;
  owner?: EditingOwner | null;
  /** Where the runtime is mounted. */
  runtimeBasePath: string;
}) {
  return (
    <ContentSidebarFrame label={page?.title ?? "Canvas navigator"}>
      <SidebarStack>
        <CanvasViewHeader covered={page != null} onShowWholeCanvas={onShowWholeCanvas} />
        {page ? (
          <PageInspector page={page} owner={owner} runtimeBasePath={runtimeBasePath} />
        ) : (
          <SidebarStackView depth={0} className="flex flex-col">
            <CanvasNavigator {...navigator} />
          </SidebarStackView>
        )}
      </SidebarStack>
      <CreatePageModal />
    </ContentSidebarFrame>
  );
}
