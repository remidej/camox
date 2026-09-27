import { Button } from "@camox/ui/button";
import { FloatingToolbar } from "@camox/ui/floating-toolbar";
import { Label } from "@camox/ui/label";
import { Switch } from "@camox/ui/switch";
import { Toggle } from "@camox/ui/toggle";
import * as Tooltip from "@camox/ui/tooltip";
import { useSelector } from "@xstate/store-react";
import { MessageCircle, X } from "lucide-react";

import { DeviceSelector } from "@/components/DeviceSelector";
import { formatShortcut } from "@/lib/utils";

import { EDIT_MODE_SHORTCUT } from "../previewConstants";
import { previewStore, selectIsCommentMode, selectIsEditMode } from "../previewStore";
import { usePageComments } from "../usePageComments";

interface PreviewToolbarProps {
  onEditModeChange?: (checked: boolean) => void;
  onCommentModeChange?: (enabled: boolean) => void;
  pageId?: number;
  pageStatus?: "draft" | "published" | "modified";
  hasLiveVersion?: boolean;
}

export const PreviewToolbar = ({
  onEditModeChange,
  onCommentModeChange,
  pageId,
  pageStatus,
  hasLiveVersion,
}: PreviewToolbarProps) => {
  const isEditMode = useSelector(previewStore, selectIsEditMode);
  const isCommentMode = useSelector(previewStore, selectIsCommentMode);
  const isToolbarHidden = useSelector(previewStore, (state) => state.context.isToolbarHidden);
  const peekedBlock = useSelector(previewStore, (state) => state.context.peekedBlock);
  const viewportMode = useSelector(previewStore, (state) => state.context.viewportMode);

  const { data: comments } = usePageComments(pageStatus ? pageId : undefined);
  const commentCount = comments?.length ?? 0;

  if (isToolbarHidden || peekedBlock) return null;

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
        <Tooltip.Tooltip>
          <Tooltip.TooltipTrigger
            render={
              <Toggle
                pressed={isCommentMode}
                data-state={isCommentMode ? "on" : "off"}
                onPressedChange={(enabled) => {
                  if (onCommentModeChange) {
                    onCommentModeChange(enabled);
                    return;
                  }

                  if (enabled && !isEditMode) {
                    previewStore.send({ type: "enterEditMode" });
                  }
                  previewStore.send({ type: "setCommentMode", enabled });
                }}
                variant="outline"
              />
            }
          >
            <MessageCircle />
            Feedback
            {commentCount > 0 && <span className="text-muted-foreground">({commentCount})</span>}
          </Tooltip.TooltipTrigger>
          <Tooltip.TooltipContent>Leave feedback for agents</Tooltip.TooltipContent>
        </Tooltip.Tooltip>
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
