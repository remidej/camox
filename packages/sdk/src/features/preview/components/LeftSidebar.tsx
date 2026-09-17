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
      <div
        className={`absolute inset-0 z-20 bg-black/50 transition-opacity duration-200 motion-reduce:transition-none ${
          isAddBlockSidebarOpen ? "cursor-not-allowed opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden="true"
      />
    </aside>
  );
};

export { LeftSidebar };
