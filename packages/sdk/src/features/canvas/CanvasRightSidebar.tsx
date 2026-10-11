import { useQuery } from "@tanstack/react-query";

import type { Block } from "../../core/createBlock";
import { blockQueries } from "../../lib/queries";
import { useNavigate } from "../navigation/navigation";
import { RightSidebar } from "../preview/components/RightSidebar";
import { CMS_SIDEBAR_WIDTH } from "../preview/previewConstants";
import { PreviewEditingOwnerContext } from "../preview/previewSelection";
import type { EditingOwner } from "../preview/previewStore";
import type { CanvasPage } from "./canvasPages";

/**
 * A selected block's description and the Pages using it. Picking a Page selects
 * it through regular navigation, so the camera flies to it.
 */
function BlockUsageSidebar({ block, projectId }: { block: Block; projectId: number }) {
  const navigate = useNavigate();
  const { title, description, id } = block._internal;
  const pages = useQuery(blockQueries.getPagesUsing(projectId, id));
  return (
    <aside
      aria-label={`About ${title}`}
      className="bg-background relative flex shrink-0 flex-col gap-6 overflow-auto border-l-2 p-4"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      <section className="space-y-2">
        <p className="text-base font-semibold">{title}</p>
        <p className="text-muted-foreground text-sm">{description}</p>
      </section>
      <section className="space-y-2">
        <p className="text-sm font-medium">Used on</p>
        {pages.isPending ? (
          <p role="status" className="text-muted-foreground text-sm">
            Loading pages…
          </p>
        ) : pages.error ? (
          <p role="alert" className="text-muted-foreground text-sm">
            Could not load the pages using this block.
          </p>
        ) : pages.data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No pages use this block yet.</p>
        ) : (
          <ul className="-mx-2 flex flex-col gap-0.5">
            {pages.data.map((page) => (
              <li key={page.id}>
                <button
                  type="button"
                  className="hover:bg-accent focus-visible:ring-ring flex w-full min-w-0 items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2"
                  onClick={() => void navigate({ to: page.fullPath })}
                >
                  <span className="truncate">{page.nickname}</span>
                  <span className="text-muted-foreground truncate">{page.fullPath}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

export function CanvasRightSidebar({
  page,
  block,
  projectId,
  owner = null,
}: {
  page: CanvasPage | undefined;
  /** The selected block of the Block Catalog, if any. */
  block?: Block;
  projectId?: number;
  owner?: EditingOwner | null;
}) {
  if (block && projectId != null) return <BlockUsageSidebar block={block} projectId={projectId} />;
  if (!page) return null;

  return (
    <PreviewEditingOwnerContext value={owner}>
      <RightSidebar key={page.key} pageId={page.pageId} derivedLayoutId={page.layoutId} />
    </PreviewEditingOwnerContext>
  );
}
