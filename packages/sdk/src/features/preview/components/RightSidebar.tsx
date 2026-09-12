import { useSelector } from "@xstate/store-react";

import { CMS_SIDEBAR_WIDTH } from "../previewConstants";
import { previewStore, selectionBlockId } from "../previewStore";
import { PageEditorSidebar } from "./PageEditorSidebar";
import { PageInfoSidebar } from "./PageInfoSidebar";

const RightSidebar = ({ pageId }: { pageId?: number }) => {
  const selection = useSelector(previewStore, (state) => state.context.selection);
  const isAddBlockSidebarOpen = useSelector(
    previewStore,
    (state) => state.context.isAddBlockSidebarOpen,
  );
  const selectedBlockId = selectionBlockId(selection);
  // Derived URLs have no page settings; show the inspector only for a shared block selection.
  if (pageId == null && selectedBlockId == null) return null;

  return (
    <aside
      className="bg-background relative flex shrink-0 flex-col border-l-2"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      {selectedBlockId == null && pageId != null ? (
        <PageInfoSidebar pageId={pageId} />
      ) : (
        <PageEditorSidebar />
      )}
      {isAddBlockSidebarOpen && (
        <div
          className="absolute inset-0 z-20"
          style={{ background: "rgba(0, 0, 0, 0.66)" }}
          onClick={() => previewStore.send({ type: "closeAddBlockSidebar" })}
        />
      )}
    </aside>
  );
};

export { RightSidebar };
