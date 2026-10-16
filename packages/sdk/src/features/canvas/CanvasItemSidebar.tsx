import { Button } from "@camox/ui/button";
import { Minimize2 } from "lucide-react";
import type * as React from "react";

import { CMS_SIDEBAR_WIDTH } from "../preview/previewConstants";

/**
 * The left sidebar of a selected Canvas item: its name, beside a button that leaves
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
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Back to the Canvas"
          onClick={onBack}
        >
          <Minimize2 />
        </Button>
        <h2 className="truncate text-base font-medium">{title}</h2>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  );
}
