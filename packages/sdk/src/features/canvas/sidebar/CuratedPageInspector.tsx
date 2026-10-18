import * as React from "react";

import { useProjectSlug } from "../../../lib/auth";
import { reads, useRead } from "../../../lib/studio-reads";
import { useLocation } from "../../navigation/navigation";
import { AddBlockDialog } from "../../preview/components/AddBlockDialog";
import { PageInfo } from "../../preview/components/PageInfo";
import { PageTree } from "../../preview/components/PageTree";
import { PreviewEditingOwnerContext } from "../../preview/previewSelection";
import { PageOverview } from "./PageOverview";

/** A curated page: its blocks, which editors arrange, then what's about the page. */
export function CuratedPageInspector() {
  const { pathname } = useLocation();
  const projectSlug = useProjectSlug();
  const owner = React.useContext(PreviewEditingOwnerContext);
  // PageTree reads the same page through usePreviewedPage.
  const structure = useRead(reads.pageStructure({ path: pathname, projectSlug }));
  const pageId = structure.page.id;
  return (
    <>
      <PageOverview>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <div className="px-2 pt-5">
            <PageTree collapsible />
          </div>
          <PageInfo pageId={pageId} scrollable={false} />
        </div>
      </PageOverview>
      <AddBlockDialog focusCreatedBlock={owner?.kind === "page" && owner.pageId === pageId} />
    </>
  );
}
