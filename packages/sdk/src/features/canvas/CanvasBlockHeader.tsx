import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";

import type { Block } from "../../core/createBlock";

/**
 * The header above a block of the Block Catalog. Its title sits on the line of
 * Page nicknames, and its description shows in a tooltip.
 */
export function CanvasBlockHeader({ block }: { block: Block }) {
  const { title, description } = block._internal;
  return (
    <h2 className="text-foreground flex h-10 w-full min-w-0 flex-col items-start justify-end text-left">
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
    </h2>
  );
}
