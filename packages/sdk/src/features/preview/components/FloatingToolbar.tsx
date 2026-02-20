import { Lock, MonitorPlay, PanelRight, TabletSmartphone } from "lucide-react";
import { useSelector } from "@xstate/store/react";

import { previewStore } from "../previewStore";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import * as Tooltip from "@/components/ui/tooltip";
import { cn, getActionShortcut } from "@/lib/utils";
import { actionsStore } from "../../provider/actionsStore";
import { ButtonGroup } from "@/components/ui/button-group";
import { Kbd } from "@/components/ui/kbd";

export const FloatingToolbar = () => {
  const isEditingLocked = useSelector(
    previewStore,
    (state) => state.context.isContentLocked,
  );
  const isEditingPanelOpen = useSelector(
    previewStore,
    (state) => state.context.isSidebarOpen,
  );
  const isPresentationMode = useSelector(
    previewStore,
    (state) => state.context.isPresentationMode,
  );
  const isPageContentSheetOpen = useSelector(
    previewStore,
    (state) => state.context.isPageContentSheetOpen,
  );
  const isAddBlockSheetOpen = useSelector(
    previewStore,
    (state) => state.context.isAddBlockSheetOpen,
  );
  const isAnySideSheetOpen = isPageContentSheetOpen || isAddBlockSheetOpen;
  const actions = useSelector(actionsStore, (state) => state.context.actions);
  const isMobileMode = useSelector(
    previewStore,
    (state) => state.context.isMobileMode,
  );

  return (
    <>
      <menu
        role="toolbar"
        className={cn(
          "absolute bg-background/95 backdrop-blur-lg p-2 rounded-lg shadow-2xl bottom-2 left-[50%] translate-x-[-50%] z-30  flex items-center gap-4 justify-between border-1 transition-all duration-200",
          isAnySideSheetOpen &&
            "opacity-0 pointer-events-none translate-y-full",
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
              Toggle sidebar{" "}
              {getActionShortcut(actions, "toggle-editing-panel")}
            </Tooltip.TooltipContent>
          </Tooltip.Tooltip>
          <Tooltip.Tooltip>
            <Tooltip.TooltipTrigger asChild>
              <Toggle
                data-state={isEditingLocked ? "on" : "off"}
                pressed={isEditingLocked}
                onPressedChange={() =>
                  previewStore.send({ type: "toggleLockContent" })
                }
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
                onPressedChange={() =>
                  previewStore.send({ type: "toggleMobileMode" })
                }
                variant="outline"
              >
                <TabletSmartphone />
              </Toggle>
            </Tooltip.TooltipTrigger>
            <Tooltip.TooltipContent>
              Toggle mobile layout{" "}
              {getActionShortcut(actions, "toggle-mobile-mode")}
            </Tooltip.TooltipContent>
          </Tooltip.Tooltip>
          <Tooltip.Tooltip>
            <Tooltip.TooltipTrigger asChild>
              <Toggle
                data-state={isPresentationMode ? "on" : "off"}
                pressed={isPresentationMode}
                variant="outline"
                onClick={() =>
                  previewStore.send({ type: "enterPresentationMode" })
                }
              >
                <MonitorPlay />
                Preview
              </Toggle>
            </Tooltip.TooltipTrigger>
            <Tooltip.TooltipContent>
              Hide all admin interface{" "}
              {getActionShortcut(actions, "enter-presentation-mode")}
            </Tooltip.TooltipContent>
          </Tooltip.Tooltip>
        </ButtonGroup>
        <Button
          variant="outline"
          className="flex-1 justify-between bg-transparent dark:bg-transparent gap-4"
        >
          <span className="text-muted-foreground">Ask for changes...</span>
          <Kbd className="ml-4">⌘ I</Kbd>
        </Button>
      </menu>
    </>
  );
};
