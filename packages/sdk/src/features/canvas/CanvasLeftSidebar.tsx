import { queryKeys } from "@camox/api-contract/query-keys";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import * as React from "react";

import { getApiClient } from "../../lib/api-client";
import { useProjectSlug } from "../../lib/auth";
import { seedBlockCaches } from "../../lib/normalized-data";
import { scopedKey } from "../../lib/studio-draft";
import { useLocation } from "../navigation/navigation";
import { AddBlockDialog } from "../preview/components/AddBlockDialog";
import { CreatePageModal } from "../preview/components/CreatePageModal";
import { LeftSidebar } from "../preview/components/LeftSidebar";
import type { PageRecordId } from "../preview/pageRecord";
import { CMS_SIDEBAR_WIDTH } from "../preview/previewConstants";
import { PreviewEditingOwnerContext } from "../preview/previewSelection";
import type { EditingOwner } from "../preview/previewStore";
import { CanvasNavigatorSidebar } from "./CanvasNavigatorSidebar";
import type { CanvasPage } from "./canvasPages";

function SidebarMessage({ error = false }: { error?: boolean }) {
  return (
    <aside className="shrink-0 border-r-2 p-4" style={{ width: CMS_SIDEBAR_WIDTH }}>
      <p role={error ? "alert" : "status"}>
        {error ? "This page’s sidebar could not be loaded." : "Loading page sidebar…"}
      </p>
    </aside>
  );
}

class SidebarBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <SidebarMessage error />;
    return this.props.children;
  }
}

function CuratedSidebar() {
  const { pathname } = useLocation();
  const projectSlug = useProjectSlug();
  const owner = React.useContext(PreviewEditingOwnerContext);
  const { data: structure } = useSuspenseQuery({
    // PageTree reads this same query through usePreviewedPage.
    queryKey: scopedKey(queryKeys.pages.getByPath(pathname)),
    queryFn: () => getApiClient().pages.getStructure({ path: pathname, projectSlug }),
    staleTime: Infinity,
  });
  return (
    <>
      <LeftSidebar page={structure.page} />
      <AddBlockDialog
        focusCreatedBlock={owner?.kind === "page" && owner.pageId === structure.page.id}
      />
    </>
  );
}

function LayoutSidebar({ layoutId, pageRecord }: { layoutId: string; pageRecord?: PageRecordId }) {
  const projectSlug = useProjectSlug();
  const queryClient = useQueryClient();
  const { data: layout } = useSuspenseQuery({
    queryKey: scopedKey([...queryKeys.layouts.all, "get", projectSlug, layoutId]),
    queryFn: async () => {
      const result = await getApiClient().layouts.get({ projectSlug, layoutId });
      seedBlockCaches(queryClient, result);
      return result.layout;
    },
    staleTime: Infinity,
  });
  return <LeftSidebar derivedLayout={layout} pageRecord={pageRecord} />;
}

export function CanvasLeftSidebar({
  page,
  navigator,
  owner = null,
  pageRecord,
}: {
  page: CanvasPage | undefined;
  /** Shown without a selected Page: on the Canvas itself, or on a block of the Block Catalog. */
  navigator: React.ComponentProps<typeof CanvasNavigatorSidebar>;
  owner?: EditingOwner | null;
  /** The record of the selected record page, if any. */
  pageRecord?: PageRecordId;
}) {
  const { pathname } = useLocation();
  if (!page) return <CanvasNavigatorSidebar {...navigator} />;

  return (
    <PreviewEditingOwnerContext value={owner}>
      <SidebarBoundary key={`${page.key}:${pathname}`}>
        <React.Suspense fallback={<SidebarMessage />}>
          {page.pageId != null ? (
            <CuratedSidebar />
          ) : page.layoutId ? (
            <LayoutSidebar layoutId={page.layoutId} pageRecord={pageRecord} />
          ) : (
            <LeftSidebar />
          )}
          <CreatePageModal />
        </React.Suspense>
      </SidebarBoundary>
    </PreviewEditingOwnerContext>
  );
}
