import type { Block } from "../../core/createBlock";

/** How many Pages place a block, as shown in its header. */
export function formatCanvasBlockUsage(pageCount: number) {
  if (pageCount === 0) return "Unused";
  return `Used on ${pageCount} ${pageCount === 1 ? "page" : "pages"}`;
}

/**
 * The header above a block of the Block Catalog. Its title sits on the line of
 * Page nicknames and selects the block.
 * Its usage sits above the title once known, like a Page header's path.
 */
export function CanvasBlockHeader({
  block,
  pageCount,
  onSelect,
}: {
  block: Block;
  pageCount?: number;
  onSelect?: () => void;
}) {
  const { title } = block._internal;
  return (
    <h2 className="text-foreground flex h-10 w-full min-w-0 flex-col items-start justify-end gap-1 text-left">
      {pageCount !== undefined && (
        <span
          data-canvas-block-usage
          className="text-muted-foreground w-full min-w-0 truncate text-left text-xs font-normal"
        >
          {formatCanvasBlockUsage(pageCount)}
        </span>
      )}
      <button
        type="button"
        className="focus-visible:ring-ring max-w-full min-w-0 truncate text-left text-sm font-medium outline-none focus-visible:ring-2"
        onClick={onSelect}
      >
        {title}
      </button>
    </h2>
  );
}
