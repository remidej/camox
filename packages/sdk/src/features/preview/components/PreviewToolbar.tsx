import { Button } from "@camox/ui/button";
import { ButtonGroup } from "@camox/ui/button-group";
import { FloatingToolbar } from "@camox/ui/floating-toolbar";
import { Label } from "@camox/ui/label";
import { Switch } from "@camox/ui/switch";
import { Toggle } from "@camox/ui/toggle";
import * as Tooltip from "@camox/ui/tooltip";
import { useSelector } from "@xstate/store-react";
import { Monitor, Smartphone, Tablet, X } from "lucide-react";

import { formatShortcut } from "@/lib/utils";

import { EDIT_MODE_SHORTCUT } from "../previewConstants";
import { previewStore, selectIsEditMode } from "../previewStore";

interface PreviewToolbarProps {
  onEditModeChange?: (checked: boolean) => void;
  pageStatus?: "draft" | "published" | "modified";
  hasLiveVersion?: boolean;
}

export const PreviewToolbar = ({
  onEditModeChange,
  pageStatus,
  hasLiveVersion,
}: PreviewToolbarProps) => {
  const isEditMode = useSelector(previewStore, selectIsEditMode);
  const isToolbarHidden = useSelector(previewStore, (state) => state.context.isToolbarHidden);
  const peekedBlock = useSelector(previewStore, (state) => state.context.peekedBlock);
  const viewportMode = useSelector(previewStore, (state) => state.context.viewportMode);

  if (isToolbarHidden || peekedBlock) return null;

  return (
    <FloatingToolbar className="bottom-2 w-max justify-between gap-8 transition-none">
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
      <div className="flex shrink-0 items-center gap-8 self-stretch">
        <ButtonGroup>
          <Tooltip.Tooltip>
            <Tooltip.TooltipTrigger
              render={
                <Toggle
                  data-state={viewportMode === "full" ? "on" : "off"}
                  pressed={viewportMode === "full"}
                  onPressedChange={() => {
                    if (viewportMode === "full") return;
                    previewStore.send({ type: "setViewportMode", mode: "full" });
                  }}
                  variant="outline"
                />
              }
            >
              <Monitor />
            </Tooltip.TooltipTrigger>
            <Tooltip.TooltipContent>Full view</Tooltip.TooltipContent>
          </Tooltip.Tooltip>
          <Tooltip.Tooltip>
            <Tooltip.TooltipTrigger
              render={
                <Toggle
                  data-state={viewportMode === "tablet" ? "on" : "off"}
                  pressed={viewportMode === "tablet"}
                  onPressedChange={() => {
                    if (viewportMode === "tablet") return;
                    previewStore.send({ type: "setViewportMode", mode: "tablet" });
                  }}
                  variant="outline"
                />
              }
            >
              <Tablet />
            </Tooltip.TooltipTrigger>
            <Tooltip.TooltipContent>Tablet view</Tooltip.TooltipContent>
          </Tooltip.Tooltip>
          <Tooltip.Tooltip>
            <Tooltip.TooltipTrigger
              render={
                <Toggle
                  data-state={viewportMode === "mobile" ? "on" : "off"}
                  pressed={viewportMode === "mobile"}
                  onPressedChange={() => {
                    if (viewportMode === "mobile") return;
                    previewStore.send({ type: "setViewportMode", mode: "mobile" });
                  }}
                  variant="outline"
                />
              }
            >
              <Smartphone />
            </Tooltip.TooltipTrigger>
            <Tooltip.TooltipContent>Mobile view</Tooltip.TooltipContent>
          </Tooltip.Tooltip>
        </ButtonGroup>
        <div className="flex items-center gap-2">
          {pageStatus && (
            <Button
              type="button"
              variant="outline"
              disabled={pageStatus === "published" || !hasLiveVersion}
              onClick={() => previewStore.send({ type: "viewLivePage" })}
            >
              View live page
            </Button>
          )}
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
