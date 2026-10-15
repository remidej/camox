import { useQuery } from "@tanstack/react-query";

import type { Block } from "../../core/createBlock";
import { blockQueries } from "../../lib/queries";
import { useLocation, useNavigate } from "../navigation/navigation";
import { RightSidebar } from "../preview/components/RightSidebar";
import { CMS_SIDEBAR_WIDTH } from "../preview/previewConstants";
import { PreviewEditingOwnerContext } from "../preview/previewSelection";
import type { EditingOwner } from "../preview/previewStore";
import { CanvasChatSidebar } from "./CanvasChatSidebar";
import type { CanvasPage } from "./canvasPages";

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
  const { title, description } = block._internal;
  return (
    <aside
      aria-label={`About ${title}`}
      className="bg-background relative flex shrink-0 flex-col gap-6 overflow-auto border-l-2 p-4"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      <section className="space-y-2">
        <p className="text-base font-semibold">{title}</p>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </section>
      <section className="space-y-2">
        <p className="text-sm font-medium">Used on</p>
        <PlacementPages block={block} projectId={projectId} />
      </section>
    </aside>
  );
}

export function CanvasRightSidebar({
  page,
  catalog,
  owner = null,
}: {
  page: CanvasPage | undefined;
  /** The selected block of the Block Catalog, if any, with the Project its Pages belong to. */
  catalog?: { block: Block; projectId: number };
  owner?: EditingOwner | null;
}) {
  if (catalog) return <BlockPlacementSidebar block={catalog.block} projectId={catalog.projectId} />;
  if (!page) return <CanvasChatSidebar />;

  return (
    <PreviewEditingOwnerContext value={owner}>
      <RightSidebar key={page.key} pageId={page.pageId} derivedLayoutId={page.layoutId} />
    </PreviewEditingOwnerContext>
  );
}
