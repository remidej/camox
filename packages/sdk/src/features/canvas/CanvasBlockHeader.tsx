import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";

import type { Block } from "../../core/createBlock";

/** How many Pages place a block, as shown in its header. */
export function formatCanvasBlockUsage(pageCount: number) {
  if (pageCount === 0) return "Unused";
  return `Used on ${pageCount} ${pageCount === 1 ? "page" : "pages"}`;
}

/**
 * The header above a block of the Block Catalog. Its title sits on the line of
 * Page nicknames, its description shows in a tooltip, and its usage sits on the
 * right once known.
 */
export function CanvasBlockHeader({ block, pageCount }: { block: Block; pageCount?: number }) {
  const { title, description } = block._internal;
  return (
    <h2 className="text-foreground flex h-10 w-full min-w-0 items-end justify-between gap-3 text-left">
      <Tooltip>
        <TooltipTrigger
          render={<span className="max-w-full min-w-0 truncate text-sm font-medium" />}
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
