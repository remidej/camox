import { useSelector } from "@xstate/store-react";

import { CMS_SIDEBAR_WIDTH } from "../previewConstants";
import { previewStore } from "../previewStore";
import { AddBlockSidebar } from "./AddBlockSidebar";
import { DerivedLayoutSidebar, type DerivedLayoutStructure } from "./DerivedLayoutSidebar";
import { PageNavigatorSidebar, type PreviewedPage } from "./PageNavigatorSidebar";

type LeftSidebarRoute = { type: "add-block" } | { type: "page-navigator" };

const getLeftSidebarRoute = ({
  isAddBlockSidebarOpen,
}: {
  isAddBlockSidebarOpen: boolean;
}): LeftSidebarRoute => {
  if (isAddBlockSidebarOpen) {
    return { type: "add-block" };
  }

  return { type: "page-navigator" };
};

const LeftSidebar = ({
  page,
  derivedLayout,
}: {
  page?: PreviewedPage;
  derivedLayout?: DerivedLayoutStructure;
}) => {
  const isAddBlockSidebarOpen = useSelector(
    previewStore,
    (state) => state.context.isAddBlockSidebarOpen,
  );
  const route = getLeftSidebarRoute({ isAddBlockSidebarOpen: !!page && isAddBlockSidebarOpen });

  return (
    <aside className="flex shrink-0 flex-col border-r-2" style={{ width: CMS_SIDEBAR_WIDTH }}>
      {derivedLayout ? (
        <DerivedLayoutSidebar layout={derivedLayout} />
      ) : (
        <>
          {route.type === "add-block" && <AddBlockSidebar />}
          {route.type === "page-navigator" && <PageNavigatorSidebar page={page} />}
        </>
      )}
    </aside>
  );
};

export { LeftSidebar };
