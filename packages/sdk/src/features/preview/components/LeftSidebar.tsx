import type { PageRecordId } from "../pageRecord";
import { CMS_SIDEBAR_WIDTH } from "../previewConstants";
import { DerivedLayoutSidebar, type DerivedLayoutStructure } from "./DerivedLayoutSidebar";
import { PageNavigatorSidebar, type PreviewedPage } from "./PageNavigatorSidebar";

const LeftSidebar = ({
  page,
  derivedLayout,
  pageRecord,
}: {
  page?: PreviewedPage;
  derivedLayout?: DerivedLayoutStructure;
  /** The record of a record page. */
  pageRecord?: PageRecordId;
}) => {
  return (
    <aside
      className="relative flex shrink-0 flex-col border-r-2"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      {derivedLayout ? (
        <DerivedLayoutSidebar layout={derivedLayout} pageRecord={pageRecord} />
      ) : (
        <PageNavigatorSidebar page={page} />
      )}
    </aside>
  );
};

export { LeftSidebar };
