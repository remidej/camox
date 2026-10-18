import type { Block } from "../../../core/createBlock";
import { reads, useReadQuery } from "../../../lib/studio-reads";
import { useLocation, useNavigate } from "../../navigation/navigation";
import {
  CanvasInspectorBody,
  CanvasInspectorHeader,
  CanvasInspectorTitle,
} from "./CanvasInspector";

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
  const pages = useReadQuery(reads.pagesUsingBlock({ projectId, type: block._internal.id }));
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

/** A block of the Block Catalog: its description and the Pages holding its placements. */
export function CatalogBlockInspector({
  block,
  projectId,
  onBack,
}: {
  block: Block;
  /** The Project its Pages belong to. */
  projectId: number;
  onBack: () => void;
}) {
  const { title, description } = block._internal;
  return (
    <>
      <CanvasInspectorHeader onBack={onBack}>
        <CanvasInspectorTitle>{title}</CanvasInspectorTitle>
      </CanvasInspectorHeader>
      <CanvasInspectorBody>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-4">
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
          <section className="space-y-2">
            <p className="text-sm font-medium">Used on</p>
            <PlacementPages block={block} projectId={projectId} />
          </section>
        </div>
      </CanvasInspectorBody>
    </>
  );
}
