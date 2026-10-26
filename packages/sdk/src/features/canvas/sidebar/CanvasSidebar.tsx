import type * as React from "react";

import { CreatePageModal } from "../../preview/components/CreatePageModal";
import { SidebarStack, SidebarStackView } from "../../preview/components/SidebarStack";
import type { PageRecordId } from "../../preview/pageRecord";
import type { EditingOwner } from "../../preview/previewStore";
import type { CanvasPage } from "../canvasPages";
import { CanvasNavigator } from "./CanvasNavigator";
import { CanvasSidebarFrame } from "./CanvasSidebarFrame";
import { CanvasViewHeader } from "./CanvasViewHeader";
import { PageInspector } from "./PageInspector";

/**
 * The sidebar beside the Canvas, a stack of views: the Canvas's own, which shows the Canvas
 * Navigator, then the Canvas Inspector of the selected Page laid over it, if any.
 */
export function CanvasSidebar({
  page,
  navigator,
  onShowWholeCanvas,
  owner = null,
  pageRecord,
  runtimeBasePath,
}: {
  page: CanvasPage | undefined;
  /** Shown without a selection, on the Canvas itself. */
  navigator: React.ComponentProps<typeof CanvasNavigator>;
  /** Leaves the selection for the whole Canvas, where the navigator shows. */
  onShowWholeCanvas: () => void;
  owner?: EditingOwner | null;
  /** The record of the selected record page, if any. */
  pageRecord?: PageRecordId;
  /** Where the runtime is mounted. */
  runtimeBasePath: string;
}) {
  return (
    <CanvasSidebarFrame label={page?.title ?? "Canvas navigator"}>
      <SidebarStack>
        <CanvasViewHeader covered={page != null} onShowWholeCanvas={onShowWholeCanvas} />
        {page ? (
          <PageInspector
            page={page}
            owner={owner}
            pageRecord={pageRecord}
            runtimeBasePath={runtimeBasePath}
          />
        ) : (
          <SidebarStackView depth={0} className="flex flex-col">
            <CanvasNavigator {...navigator} />
          </SidebarStackView>
        )}
      </SidebarStack>
      <CreatePageModal />
    </CanvasSidebarFrame>
  );
}
