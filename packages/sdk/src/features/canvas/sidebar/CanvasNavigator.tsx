import { Button } from "@camox/ui/button";
import { CheckIcon, Plus } from "lucide-react";

import { previewStore } from "../../preview/previewStore";
import { canvasPagePath, type CanvasPage } from "../canvasPages";

/**
 * The Canvas Navigator, shown while nothing is selected: every Page of the Canvas,
 * in Canvas order, with its path. Picking a Page shows it: the camera goes to it. One card
 * groups them, a line across it between each Page.
 */
export function CanvasNavigator({
  pages,
  selectedKey,
  onShowPage,
}: {
  pages: readonly CanvasPage[];
  /** The key of the selected Page, if any. */
  selectedKey?: string;
  onShowPage: (key: string) => void;
}) {
  return (
    <nav
      data-canvas-navigator
      aria-label="Pages"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1"
    >
      {pages.length > 0 && (
        <ul className="bg-background divide-border/50 border-border/70 m-1 flex shrink-0 flex-col divide-y overflow-hidden rounded-lg border">
          {pages.map((page) => {
            const selected = page.key === selectedKey;
            const path = canvasPagePath(page);
            return (
              <li key={page.key}>
                <button
                  type="button"
                  data-canvas-navigator-page={page.key}
                  aria-current={selected ? "page" : undefined}
                  className="hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left text-sm outline-hidden transition-colors"
                  onClick={() => onShowPage(page.key)}
                >
                  <span className="flex min-w-0 flex-col py-0.5">
                    <span className="truncate font-medium">{page.title}</span>
                    {path && (
                      <span className="text-muted-foreground truncate font-mono text-xs">
                        {path}
                      </span>
                    )}
                  </span>
                  {selected && (
                    <CheckIcon className="text-muted-foreground mt-[3px] ml-auto size-4 shrink-0" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="p-1">
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => previewStore.send({ type: "openCreatePageModal" })}
        >
          <Plus />
          Create page
        </Button>
      </div>
    </nav>
  );
}
