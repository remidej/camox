import type * as React from "react";

import type { Block } from "../../../core/createBlock";
import { CreatePageModal } from "../../preview/components/CreatePageModal";
import type { PageRecordId } from "../../preview/pageRecord";
import type { EditingOwner } from "../../preview/previewStore";
import type { CanvasPage } from "../canvasPages";
import { CanvasNavigator } from "./CanvasNavigator";
import { CanvasSidebarFrame } from "./CanvasSidebarFrame";
import { CatalogBlockInspector } from "./CatalogBlockInspector";
import { PageInspector } from "./PageInspector";

/**
 * The sidebar beside the Canvas. Without a selection, it shows the Canvas Navigator;
 * with one, the Canvas Inspector of the selected Page or block of the Block Catalog.
 */
export function CanvasSidebar({
  page,
  catalog,
  navigator,
  onShowWholeCanvas,
  onRenamePage,
  owner = null,
  pageRecord,
}: {
  page: CanvasPage | undefined;
  /** The selected block of the Block Catalog, if any, with the Project its Pages belong to. */
  catalog?: { block: Block; projectId: number };
  /** Shown without a selection, on the Canvas itself. */
  navigator: React.ComponentProps<typeof CanvasNavigator>;
  /** Leaves the selection for the whole Canvas, where the navigator shows. */
  onShowWholeCanvas: () => void;
  /** Renames a curated page from the inspector's header. */
  onRenamePage?: (pageId: string, nickname: string) => Promise<void>;
  owner?: EditingOwner | null;
  /** The record of the selected record page, if any. */
  pageRecord?: PageRecordId;
}) {
  return (
    <CanvasSidebarFrame label={catalog?.block._internal.title ?? page?.title ?? "Canvas navigator"}>
      {catalog ? (
        <CatalogBlockInspector
          block={catalog.block}
          projectId={catalog.projectId}
          onBack={onShowWholeCanvas}
        />
      ) : page ? (
        <PageInspector
          page={page}
          owner={owner}
          pageRecord={pageRecord}
          onBack={onShowWholeCanvas}
          onRenamePage={onRenamePage}
        />
      ) : (
        <CanvasNavigator {...navigator} />
      )}
      <CreatePageModal />
    </CanvasSidebarFrame>
  );
}
