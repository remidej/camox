import { Button } from "@camox/ui/button";
import { FloatingToolbar } from "@camox/ui/floating-toolbar";
import { Label } from "@camox/ui/label";
import { Switch } from "@camox/ui/switch";
import * as Tooltip from "@camox/ui/tooltip";
import { useSelector } from "@xstate/store-react";
import { X } from "lucide-react";

import { DeviceSelector } from "@/components/DeviceSelector";
import { formatShortcut } from "@/lib/utils";

import { EDIT_MODE_SHORTCUT } from "../previewConstants";
import { previewStore, selectIsEditMode } from "../previewStore";

interface PreviewToolbarProps {
  onEditModeChange?: (checked: boolean) => void;
}

export const PreviewToolbar = ({ onEditModeChange }: PreviewToolbarProps) => {
  const isEditMode = useSelector(previewStore, selectIsEditMode);
  const isToolbarHidden = useSelector(previewStore, (state) => state.context.isToolbarHidden);
  const viewportMode = useSelector(previewStore, (state) => state.context.viewportMode);

  if (isToolbarHidden) return null;

  return (
    <FloatingToolbar className="bottom-2 w-max justify-between gap-6 transition-none">
      <div className="flex shrink-0 items-center gap-2 px-2">
        <Switch
          id="edit-mode"
          checked={isEditMode}
          onCheckedChange={(checked) => {
            if (onEditModeChange) {
              onEditModeChange(checked);
              return;
            }

            previewStore.send({
              type: checked ? "enterEditMode" : "exitEditMode",
            });
          }}
        />
        <Label htmlFor="edit-mode" className="flex items-center gap-2">
          Edit mode {formatShortcut(EDIT_MODE_SHORTCUT)}
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
                  disabled={isEditMode}
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
  );
};
