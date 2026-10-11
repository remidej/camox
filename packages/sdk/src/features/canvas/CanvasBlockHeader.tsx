import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";

import type { Block } from "../../core/createBlock";

/** How many Pages place a block, as shown in its header. */
export function formatCanvasBlockUsage(pageCount: number) {
  if (pageCount === 0) return "Unused";
  return `Used on ${pageCount} ${pageCount === 1 ? "page" : "pages"}`;
}

/**
 * The header above a block of the Block Catalog. Its title sits on the line of
 * Page nicknames, shows the description in a tooltip, and selects the block.
 * Its usage sits on the right once known.
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
  const { title, description } = block._internal;
  return (
    <h2 className="text-foreground flex h-10 w-full min-w-0 items-end justify-between gap-3 text-left">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="focus-visible:ring-ring max-w-full min-w-0 truncate text-left text-sm font-medium outline-none focus-visible:ring-2"
              onClick={onSelect}
            />
          }
        >
          {title}
        </TooltipTrigger>
        <TooltipContent side="top" align="start">
          {description}
        </TooltipContent>
      </Tooltip>
      {pageCount !== undefined && (
        <span data-canvas-block-usage className="text-muted-foreground shrink-0 text-sm">
          {formatCanvasBlockUsage(pageCount)}
        </span>
      )}
    </h2>
  );
}
