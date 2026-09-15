import { useSelector } from "@xstate/store-react";

import { CMS_SIDEBAR_WIDTH } from "../previewConstants";
import { previewStore, selectionBlockId } from "../previewStore";
import { AddBlockSidebar } from "./AddBlockSidebar";
import { DerivedPageInfoSidebar } from "./DerivedPageInfoSidebar";
import { PageEditorSidebar } from "./PageEditorSidebar";
import { PageInfoSidebar } from "./PageInfoSidebar";

const RightSidebar = ({
  pageId,
  derivedLayoutId,
}: {
  pageId?: number;
  derivedLayoutId?: string;
}) => {
  const selection = useSelector(previewStore, (state) => state.context.selection);
  const isAddBlockSidebarOpen = useSelector(
    previewStore,
    (state) => state.context.isAddBlockSidebarOpen,
  );
  const selectedBlockId = selectionBlockId(selection);
  if (pageId == null && derivedLayoutId == null && selectedBlockId == null) return null;

  return (
    <aside
      className="bg-background relative flex shrink-0 flex-col border-l-2"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      {pageId != null && isAddBlockSidebarOpen ? (
        <AddBlockSidebar />
      ) : selectedBlockId != null ? (
        <PageEditorSidebar />
      ) : pageId != null ? (
        <PageInfoSidebar pageId={pageId} />
      ) : (
        <DerivedPageInfoSidebar layoutId={derivedLayoutId!} />
      )}
    </aside>
  );
};

export { RightSidebar };
