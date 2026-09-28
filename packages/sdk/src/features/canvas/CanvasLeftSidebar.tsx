import { queryKeys } from "@camox/api-contract/query-keys";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { getApiClient } from "../../lib/api-client";
import { useProjectSlug } from "../../lib/auth";
import { seedBlockCaches } from "../../lib/normalized-data";
import { NavigationProvider, useLocation, useNavigate } from "../navigation/navigation";
import { AddBlockDialog } from "../preview/components/AddBlockDialog";
import { CreatePageModal } from "../preview/components/CreatePageModal";
import { LeftSidebar } from "../preview/components/LeftSidebar";
import { CMS_SIDEBAR_WIDTH } from "../preview/previewConstants";
import { PreviewEditingOwnerContext } from "../preview/previewSelection";
import { previewStore, selectPreviewSource, type EditingOwner } from "../preview/previewStore";
import type { CanvasPage } from "./canvasPages";
import { canvasSelectionUrl, selectedCanvasPath } from "./canvasSelection";

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
  const source = useSelector(previewStore, selectPreviewSource);
  const { data: structure } = useSuspenseQuery({
    // PageTree reads this same cache slot through usePreviewedPage.
    queryKey: queryKeys.pages.getByPath(pathname, source),
    queryFn: () => getApiClient().pages.getStructure({ path: pathname, projectSlug, source }),
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

function LayoutSidebar({ layoutId }: { layoutId: string }) {
  const projectSlug = useProjectSlug();
  const source = useSelector(previewStore, selectPreviewSource);
  const queryClient = useQueryClient();
  const { data: layout } = useSuspenseQuery({
    queryKey: [...queryKeys.layouts.all, "get", projectSlug, layoutId, source],
    queryFn: async () => {
      const result = await getApiClient().layouts.get({ projectSlug, layoutId, source });
      seedBlockCaches(queryClient, result, source);
      return result.layout;
    },
    staleTime: Infinity,
  });
  return <LeftSidebar derivedLayout={layout} />;
}

export function CanvasLeftSidebar({
  page,
  owner = null,
}: {
  page: CanvasPage | undefined;
  owner?: EditingOwner | null;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const source = useSelector(previewStore, selectPreviewSource);
  if (!page) return null;

  // A template card has no concrete pathname. The outer URL is the selected
  // instance, and also the only source of truth when the picker navigates.
  const pathname = selectedCanvasPath(location.pathname);
  return (
    <NavigationProvider
      location={{ pathname, href: pathname, search: "", hash: "" }}
      navigate={({ to, replace }) => navigate({ to: canvasSelectionUrl(to), replace })}
    >
      <PreviewEditingOwnerContext value={owner}>
        <SidebarBoundary key={`${page.key}:${pathname}:${source}`}>
          <React.Suspense fallback={<SidebarMessage />}>
            {page.pageId != null ? (
              <CuratedSidebar />
            ) : page.layoutId ? (
              <LayoutSidebar layoutId={page.layoutId} />
            ) : (
              <LeftSidebar />
            )}
            <CreatePageModal />
          </React.Suspense>
        </SidebarBoundary>
      </PreviewEditingOwnerContext>
    </NavigationProvider>
  );
}
