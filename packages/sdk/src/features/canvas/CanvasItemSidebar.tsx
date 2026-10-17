import { Button } from "@camox/ui/button";
import * as Tooltip from "@camox/ui/tooltip";
import { Minimize2 } from "lucide-react";
import type * as React from "react";

import { formatShortcut } from "@/lib/utils";

import { CMS_SIDEBAR_WIDTH, SHOW_WHOLE_CANVAS_SHORTCUT } from "../preview/previewConstants";

/**
 * The Canvas sidebar's view of a selected Canvas item: its name, beside a button that leaves
 * the selection and zooms out to the whole Canvas, then the item's content.
 */
export function CanvasItemSidebar({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside
      aria-label={title}
      data-canvas-item-sidebar
      className="bg-background relative flex shrink-0 flex-col border-r-2"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      <header className="flex min-w-0 items-center gap-1 border-b-2 p-2">
        <Tooltip.Tooltip>
          <Tooltip.TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Show whole canvas"
                onClick={onBack}
              />
            }
          >
            <Minimize2 />
          </Tooltip.TooltipTrigger>
          <Tooltip.TooltipContent side="bottom">
            Show whole canvas {formatShortcut(SHOW_WHOLE_CANVAS_SHORTCUT)}
          </Tooltip.TooltipContent>
        </Tooltip.Tooltip>
        <h2 className="truncate text-base font-medium">{title}</h2>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  );
}
