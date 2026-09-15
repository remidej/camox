import { useSelector } from "@xstate/store-react";

import { CMS_SIDEBAR_WIDTH } from "../previewConstants";
import { previewStore } from "../previewStore";
import { DerivedLayoutSidebar, type DerivedLayoutStructure } from "./DerivedLayoutSidebar";
import { PageNavigatorSidebar, type PreviewedPage } from "./PageNavigatorSidebar";

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

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r-2"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      <div className="contents" inert={isAddBlockSidebarOpen}>
        {derivedLayout ? (
          <DerivedLayoutSidebar layout={derivedLayout} />
        ) : (
          <PageNavigatorSidebar page={page} />
        )}
      </div>
      {isAddBlockSidebarOpen && (
        <div
          className="absolute inset-0 z-20 cursor-not-allowed"
          style={{ background: "rgba(0, 0, 0, 0.5)" }}
          aria-hidden="true"
        />
      )}
    </aside>
  );
};

export { LeftSidebar };
