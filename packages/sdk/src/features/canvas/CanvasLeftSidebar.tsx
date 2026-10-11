import { queryKeys } from "@camox/api-contract/query-keys";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import type { Block } from "../../core/createBlock";
import { getApiClient } from "../../lib/api-client";
import { useProjectSlug } from "../../lib/auth";
import { seedBlockCaches } from "../../lib/normalized-data";
import { useLocation, useNavigate } from "../navigation/navigation";
import { AddBlockDialog } from "../preview/components/AddBlockDialog";
import { CreatePageModal } from "../preview/components/CreatePageModal";
import { LeftSidebar } from "../preview/components/LeftSidebar";
import { CMS_SIDEBAR_WIDTH } from "../preview/previewConstants";
import { PreviewEditingOwnerContext } from "../preview/previewSelection";
import { previewStore, selectPreviewSource, type EditingOwner } from "../preview/previewStore";
import { blockCatalogPath } from "../studio/routes";
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

/**
 * Every block of the Block Catalog, in Canvas order. Picking one selects it
 * through regular navigation, so the camera flies to it.
 */
function BlockCatalogSidebar({ block, blocks }: { block: Block; blocks: readonly Block[] }) {
  const { search, hash } = useLocation();
  const navigate = useNavigate();
  return (
    <aside
      aria-label="Block Catalog"
      className="relative flex shrink-0 flex-col overflow-auto border-r-2 p-2"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      <p className="px-2 pt-2 pb-3 text-base font-semibold">Blocks</p>
      <ul className="flex flex-col gap-0.5">
        {blocks.map(({ _internal: { id, title } }) => {
          const selected = id === block._internal.id;
          return (
            <li key={id}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                className={`hover:bg-accent focus-visible:ring-ring w-full truncate rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 ${selected ? "bg-accent font-medium" : ""}`}
                onClick={() => void navigate({ to: `${blockCatalogPath(id)}${search}${hash}` })}
              >
                {title}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export function CanvasLeftSidebar({
  page,
  catalog,
  owner = null,
}: {
  page: CanvasPage | undefined;
  /** The selected block of the Block Catalog, if any, with the Block Catalog in Canvas order. */
  catalog?: { block: Block; blocks: readonly Block[] };
  owner?: EditingOwner | null;
}) {
  const { pathname } = useLocation();
  const source = useSelector(previewStore, selectPreviewSource);
  if (catalog) return <BlockCatalogSidebar block={catalog.block} blocks={catalog.blocks} />;
  if (!page) return null;

  return (
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
  );
}
