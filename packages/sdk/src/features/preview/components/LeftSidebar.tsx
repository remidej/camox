import { CMS_SIDEBAR_WIDTH } from "../previewConstants";
import { DerivedLayoutSidebar, type DerivedLayoutStructure } from "./DerivedLayoutSidebar";
import { PageNavigatorSidebar, type PreviewedPage } from "./PageNavigatorSidebar";

const LeftSidebar = ({
  page,
  derivedLayout,
}: {
  page?: PreviewedPage;
  derivedLayout?: DerivedLayoutStructure;
}) => {
  return (
    <aside
      className="relative flex shrink-0 flex-col border-r-2"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      {derivedLayout ? (
        <DerivedLayoutSidebar layout={derivedLayout} />
      ) : (
        <PageNavigatorSidebar page={page} />
      )}
    </aside>
  );
};

export { LeftSidebar };
