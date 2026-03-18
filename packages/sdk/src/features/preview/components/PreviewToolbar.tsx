import { Button } from "@camox/ui/button";
import { ButtonGroup } from "@camox/ui/button-group";
import { FloatingToolbar } from "@camox/ui/floating-toolbar";
import { Kbd } from "@camox/ui/kbd";
import { Toggle } from "@camox/ui/toggle";
import * as Tooltip from "@camox/ui/tooltip";
import { useSelector } from "@xstate/store/react";
import { Lock, MonitorPlay, PanelRight, TabletSmartphone } from "lucide-react";

import { cn, getActionShortcut } from "@/lib/utils";

import { actionsStore } from "../../provider/actionsStore";
import { previewStore } from "../previewStore";

export const PreviewToolbar = () => {
  const isEditingLocked = useSelector(previewStore, (state) => state.context.isContentLocked);
  const isEditingPanelOpen = useSelector(previewStore, (state) => state.context.isSidebarOpen);
  const isPresentationMode = useSelector(previewStore, (state) => state.context.isPresentationMode);
  const isPageContentSheetOpen = useSelector(
    previewStore,
    (state) => state.context.isPageContentSheetOpen,
  );
  const isAddBlockSheetOpen = useSelector(
    previewStore,
    (state) => state.context.isAddBlockSheetOpen,
  );
  const isAgentChatSheetOpen = useSelector(
    previewStore,
    (state) => state.context.isAgentChatSheetOpen,
  );
  const isAnySideSheetOpen = isPageContentSheetOpen || isAddBlockSheetOpen || isAgentChatSheetOpen;
  const actions = useSelector(actionsStore, (state) => state.context.actions);
  const isMobileMode = useSelector(previewStore, (state) => state.context.isMobileMode);

  return (
    <FloatingToolbar
      className={cn(
        "bottom-2 gap-4 justify-between",
        isAnySideSheetOpen && "opacity-0 pointer-events-none translate-y-full",
      )}
    >
      <ButtonGroup>
        <Tooltip.Tooltip>
          <Tooltip.TooltipTrigger asChild>
            <Toggle
              data-state={isEditingPanelOpen ? "off" : "on"}
              pressed={!isEditingPanelOpen}
              variant="outline"
              onClick={() => previewStore.send({ type: "toggleSidebar" })}
            >
              <PanelRight />
            </Toggle>
          </Tooltip.TooltipTrigger>
          <Tooltip.TooltipContent>
            Toggle sidebar {getActionShortcut(actions, "toggle-editing-panel")}
          </Tooltip.TooltipContent>
        </Tooltip.Tooltip>
        <Tooltip.Tooltip>
          <Tooltip.TooltipTrigger asChild>
            <Toggle
              data-state={isEditingLocked ? "on" : "off"}
              pressed={isEditingLocked}
              onPressedChange={() => previewStore.send({ type: "toggleLockContent" })}
              variant="outline"
            >
              <Lock />
            </Toggle>
          </Tooltip.TooltipTrigger>
          <Tooltip.TooltipContent>
            Toggle edit mode <Kbd>L</Kbd>
          </Tooltip.TooltipContent>
        </Tooltip.Tooltip>
        <Tooltip.Tooltip>
          <Tooltip.TooltipTrigger asChild>
            <Toggle
              data-state={isMobileMode ? "on" : "off"}
              pressed={isMobileMode}
              onPressedChange={() => previewStore.send({ type: "toggleMobileMode" })}
              variant="outline"
            >
              <TabletSmartphone />
            </Toggle>
          </Tooltip.TooltipTrigger>
          <Tooltip.TooltipContent>
            Toggle mobile layout {getActionShortcut(actions, "toggle-mobile-mode")}
          </Tooltip.TooltipContent>
        </Tooltip.Tooltip>
        <Tooltip.Tooltip>
          <Tooltip.TooltipTrigger asChild>
            <Toggle
              data-state={isPresentationMode ? "on" : "off"}
              pressed={isPresentationMode}
              variant="outline"
              onClick={() => previewStore.send({ type: "enterPresentationMode" })}
            >
              <MonitorPlay />
              Preview
            </Toggle>
          </Tooltip.TooltipTrigger>
          <Tooltip.TooltipContent>
            Hide all admin interface {getActionShortcut(actions, "enter-presentation-mode")}
          </Tooltip.TooltipContent>
        </Tooltip.Tooltip>
      </ButtonGroup>
      <Button
        variant="outline"
        className="bg-transparent dark:bg-transparent"
        onClick={() => previewStore.send({ type: "openAgentChatSheet" })}
      >
        <span className="text-muted-foreground">Ask for changes...</span>
        <Kbd className="ml-4">⌘ I</Kbd>
      </Button>
    </FloatingToolbar>
  );
};
