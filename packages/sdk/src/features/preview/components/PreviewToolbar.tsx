import { Button } from "@camox/ui/button";
import { FloatingToolbar } from "@camox/ui/floating-toolbar";
import { Label } from "@camox/ui/label";
import { Switch } from "@camox/ui/switch";
import * as Tooltip from "@camox/ui/tooltip";
import { useSelector } from "@xstate/store-react";
import { X } from "lucide-react";

import { DeviceSelector } from "@/components/DeviceSelector";
import { formatShortcut } from "@/lib/shortcuts";

import { DraftBar } from "../../studio/components/DraftBar";
import { TOGGLE_CANVAS_SHORTCUT } from "../previewConstants";
import { previewStore, selectIsCanvasShown } from "../previewStore";
import { prefetchCanvas } from "./CanvasPreview";

export const PreviewToolbar = () => {
  const isCanvasShown = useSelector(previewStore, selectIsCanvasShown);
  const isToolbarHidden = useSelector(previewStore, (state) => state.context.isToolbarHidden);
  const viewportMode = useSelector(previewStore, (state) => state.context.viewportMode);

  if (isToolbarHidden) return null;

  return (
    // Fixed, so it centers on the viewport rather than on the column beside the sidebars. Only
    // the toolbars take the pointer, not the space around them.
    <div className="pointer-events-none fixed bottom-2 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
      {/* In a draft, the draft's bar sits just above the toolbar. */}
      <DraftBar stacked />
      <FloatingToolbar className="pointer-events-auto relative left-auto w-max translate-x-0 justify-between gap-6 transition-none">
        {/* Reaching for the toggle loads the Canvas, in case the idle prefetch hasn't yet. */}
        <div
          className="flex shrink-0 items-center gap-2 px-2"
          onPointerEnter={prefetchCanvas}
          onFocus={prefetchCanvas}
        >
          <Switch
            id="show-canvas"
            checked={isCanvasShown}
            onCheckedChange={(checked) =>
              previewStore.send({ type: checked ? "showCanvas" : "hideCanvas" })
            }
          />
          <Label htmlFor="show-canvas" className="flex items-center gap-2">
            Show canvas {formatShortcut(TOGGLE_CANVAS_SHORTCUT)}
          </Label>
        </div>
        <div className="flex shrink-0 items-center gap-6 self-stretch">
          <DeviceSelector
            value={viewportMode === "full" ? "desktop" : viewportMode}
            desktopLabel="Full view"
            onValueChange={(device) =>
              previewStore.send({
                type: "setViewportMode",
                mode: device === "desktop" ? "full" : device,
              })
            }
          />
          <div className="-ml-2 flex items-center gap-2">
            <Tooltip.Tooltip>
              <Tooltip.TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={isCanvasShown}
                    onClick={() => previewStore.send({ type: "hideToolbar" })}
                    aria-label="Hide toolbar"
                    className="text-muted-foreground"
                  />
                }
              >
                <X />
              </Tooltip.TooltipTrigger>
              <Tooltip.TooltipContent>Hide toolbar</Tooltip.TooltipContent>
            </Tooltip.Tooltip>
          </div>
        </div>
      </FloatingToolbar>
    </div>
  );
};
