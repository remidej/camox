import { queryKeys } from "@camox/api-contract/query-keys";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import * as React from "react";

import type { Block } from "../../core/createBlock";
import { getApiClient } from "../../lib/api-client";
import { useProjectSlug } from "../../lib/auth";
import { seedBlockCaches } from "../../lib/normalized-data";
import { blockQueries } from "../../lib/queries";
import { scopedKey } from "../../lib/studio-draft";
import { useLocation, useNavigate } from "../navigation/navigation";
import { AddBlockDialog } from "../preview/components/AddBlockDialog";
import { CreatePageModal } from "../preview/components/CreatePageModal";
import { PageSidebar } from "../preview/components/PageSidebar";
import type { PageRecordId } from "../preview/pageRecord";
import { PreviewEditingOwnerContext } from "../preview/previewSelection";
import type { EditingOwner } from "../preview/previewStore";
import { CanvasItemSidebar } from "./CanvasItemSidebar";
import { CanvasNavigatorSidebar } from "./CanvasNavigatorSidebar";
import type { CanvasPage } from "./canvasPages";

function SidebarMessage({ error = false }: { error?: boolean }) {
  return (
    <p role={error ? "alert" : "status"} className="p-4">
      {error ? "This page’s sidebar could not be loaded." : "Loading page sidebar…"}
    </p>
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
      <PageSidebar pageId={structure.page.id} />
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
  return <PageSidebar derivedLayout={layout} pageRecord={pageRecord} />;
}

function PagesMessage({ role, children }: { role?: "status" | "alert"; children: string }) {
  return (
    <p role={role} className="text-muted-foreground text-sm">
      {children}
    </p>
  );
}

/**
 * The Pages holding a placement of the block. Picking one selects it through
 * regular navigation, so the camera flies to it.
 */
function PlacementPages({ block, projectId }: { block: Block; projectId: number }) {
  const { search, hash } = useLocation();
  const navigate = useNavigate();
  const pages = useQuery(blockQueries.getPagesUsing(projectId, block._internal.id));
  if (pages.isPending) return <PagesMessage role="status">Loading pages…</PagesMessage>;
  if (pages.error)
    return <PagesMessage role="alert">Could not load the pages using this block.</PagesMessage>;
  if (pages.data.length === 0) return <PagesMessage>No pages use this block yet.</PagesMessage>;

  return (
    <ul className="-mx-2 flex flex-col gap-0.5">
      {pages.data.map((page) => (
        <li key={page.id}>
          <button
            type="button"
            className="hover:bg-accent focus-visible:ring-ring flex w-full min-w-0 items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2"
            onClick={() => void navigate({ to: `${page.fullPath}${search}${hash}` })}
          >
            <span className="truncate">{page.nickname}</span>
            <span className="text-muted-foreground truncate">{page.fullPath}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A selected block's description and the Pages holding its placements. */
function BlockPlacementSidebar({ block, projectId }: { block: Block; projectId: number }) {
  const { description } = block._internal;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-4">
      {description && <p className="text-muted-foreground text-sm">{description}</p>}
      <section className="space-y-2">
        <p className="text-sm font-medium">Used on</p>
        <PlacementPages block={block} projectId={projectId} />
      </section>
    </div>
  );
}

export function CanvasLeftSidebar({
  page,
  catalog,
  navigator,
  onShowCanvas,
  owner = null,
  pageRecord,
}: {
  page: CanvasPage | undefined;
  /** The selected block of the Block Catalog, if any, with the Project its Pages belong to. */
  catalog?: { block: Block; projectId: number };
  /** Shown without a selection, on the Canvas itself. */
  navigator: React.ComponentProps<typeof CanvasNavigatorSidebar>;
  /** Leaves the selection for the whole Canvas, where the navigator shows. */
  onShowCanvas: () => void;
  owner?: EditingOwner | null;
  /** The record of the selected record page, if any. */
  pageRecord?: PageRecordId;
}) {
  const { pathname } = useLocation();
  if (catalog) {
    return (
      <CanvasItemSidebar title={catalog.block._internal.title} onBack={onShowCanvas}>
        <BlockPlacementSidebar block={catalog.block} projectId={catalog.projectId} />
      </CanvasItemSidebar>
    );
  }
  if (!page) return <CanvasNavigatorSidebar {...navigator} />;

  return (
    <CanvasItemSidebar title={page.title} onBack={onShowCanvas}>
      <PreviewEditingOwnerContext value={owner}>
        <SidebarBoundary key={`${page.key}:${pathname}`}>
          <React.Suspense fallback={<SidebarMessage />}>
            {page.pageId != null ? (
              <CuratedSidebar />
            ) : page.layoutId ? (
              <LayoutSidebar layoutId={page.layoutId} pageRecord={pageRecord} />
            ) : (
              <PageSidebar />
            )}
            <CreatePageModal />
          </React.Suspense>
        </SidebarBoundary>
      </PreviewEditingOwnerContext>
    </CanvasItemSidebar>
  );
}
