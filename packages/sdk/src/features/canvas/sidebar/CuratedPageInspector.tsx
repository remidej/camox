import * as React from "react";

import { useProjectUuid } from "../../../lib/auth";
import { reads, useRead } from "../../../lib/studio-reads";
import { useLocalePath } from "../../../lib/view-locale";
import { AddBlockSheet } from "../../preview/components/AddBlockSheet";
import { PageInfo } from "../../preview/components/PageInfo";
import { PageTree } from "../../preview/components/PageTree";
import { PreviewEditingOwnerContext } from "../../preview/previewSelection";
import { PageOverview } from "./PageOverview";

/** A curated page: its blocks, which editors arrange, then what's about the page. */
export function CuratedPageInspector() {
  const pathname = useLocalePath();
  const projectUuid = useProjectUuid();
  const owner = React.useContext(PreviewEditingOwnerContext);
  // PageTree reads the same page through usePreviewedPage.
  const structure = useRead(reads.pageStructure({ path: pathname, projectUuid }));
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
      <AddBlockSheet focusCreatedBlock={owner?.kind === "page" && owner.pageId === pageId} />
    </>
  );
}
