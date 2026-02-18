import * as React from "react";
import { Lock, MonitorPlay, PanelRight, TabletSmartphone } from "lucide-react";
import { useSelector } from "@xstate/store/react";

import { previewStore } from "../previewStore";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Frame, useFrame } from "@/components/ui/frame";
import * as Tooltip from "@/components/ui/tooltip";
import type { Action } from "../../provider/actionsStore";
import { checkIfInputFocused, getActionShortcut } from "@/lib/utils";
import { actionsStore } from "../../provider/actionsStore";
import { PanelContent } from "@/components/ui/panel";
import { ButtonGroup } from "@/components/ui/button-group";
import { Overlays } from "./Overlays";
import { OverlayTracker } from "./OverlayTracker";
import { Kbd } from "@/components/ui/kbd";
import { SHEET_WIDTH } from "../previewConstants";
import { useBlockActionsShortcuts } from "./BlockActionsPopover";

/* -------------------------------------------------------------------------------------------------
 * FloatingToolbar
 * -----------------------------------------------------------------------------------------------*/

const FloatingToolbar = () => {
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
        className="absolute bg-background/95 backdrop-blur-lg p-2 rounded-lg shadow-2xl bottom-2 left-[50%] translate-x-[-50%] z-30  flex items-center gap-4 justify-between border-1 transition-opacity duration-150"
        style={{
          opacity: isAnySideSheetOpen ? 0 : 1,
          pointerEvents: isAnySideSheetOpen ? "none" : "auto",
        }}
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
              {isEditingLocked ? "Unlock" : "Lock"} content in this tab{" "}
              {getActionShortcut(actions, "toggle-lock-content")}
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

/* -------------------------------------------------------------------------------------------------
 * Frame
 * -----------------------------------------------------------------------------------------------*/

export const PreviewFrame = ({
  children,
  style,
  className,
  onIframeReady,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  onIframeReady?: (iframe: HTMLIFrameElement) => void;
}) => {
  return (
    <Frame className={className} style={style} onIframeReady={onIframeReady}>
      {children}
      <KeyDownForwarder />
      <OverlayTracker />
    </Frame>
  );
};

/* -------------------------------------------------------------------------------------------------
 * KeyDownForwarder
 * -----------------------------------------------------------------------------------------------*/

const KeyDownForwarder = () => {
  const { window: iframeWindow } = useFrame();
  const actions = useSelector(actionsStore, (state) => state.context.actions);

  React.useEffect(() => {
    // Do nothing if we're not in an iframe
    if (
      !iframeWindow ||
      !iframeWindow.parent ||
      iframeWindow.parent === iframeWindow
    ) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle L key hold separately — forward as holdLockContent
      if (e.key.toLowerCase() === "l" && !e.repeat && !checkIfInputFocused(iframeWindow.document)) {
        e.preventDefault();
        iframeWindow.parent.postMessage({ type: "holdLockContent" }, "*");
        return;
      }

      const matchingAction = actions.find((action) => {
        if (!action.shortcut) return false;
        if (!action.checkIfAvailable()) return false;

        // Don't trigger shortcuts when the user is typing in an input,
        // unless it's a modified shortcut (meta/alt) that isn't Backspace
        const userIsTyping = checkIfInputFocused(iframeWindow.document);
        if (userIsTyping) {
          if (!action.shortcut.withMeta && !action.shortcut.withAlt) return false;
          if (action.shortcut.key === "Backspace") return false;
        }

        const { key, withMeta, withAlt, withShift } = action.shortcut;
        return (
          key.toLowerCase() === e.key.toLowerCase() &&
          !!(withMeta) === (e.metaKey || e.ctrlKey) &&
          !!(withAlt) === e.altKey &&
          !!(withShift) === e.shiftKey
        );
      });

      // Only forward if there's a matching action
      if (matchingAction) {
        e.preventDefault();
        iframeWindow.parent.postMessage(
          {
            type: "executeAction",
            actionId: matchingAction.id,
          },
          "*",
        );
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "l") {
        iframeWindow.parent.postMessage({ type: "releaseLockContent" }, "*");
      }
    };

    iframeWindow.addEventListener("keydown", handleKeyDown);
    iframeWindow.addEventListener("keyup", handleKeyUp);
    return () => {
      iframeWindow.removeEventListener("keydown", handleKeyDown);
      iframeWindow.removeEventListener("keyup", handleKeyUp);
    };
  }, [iframeWindow, actions]);

  return null;
};

/* -------------------------------------------------------------------------------------------------
 * PreviewPanel
 * -----------------------------------------------------------------------------------------------*/

const PreviewPanel = ({ children }: { children: React.ReactNode }) => {
  useBlockActionsShortcuts();

  const iframeElement = useSelector(
    previewStore,
    (state) => state.context.iframeElement,
  );
  const handleIframeReady = React.useCallback((element: HTMLIFrameElement) => {
    previewStore.send({ type: "setIframeElement", element });
  }, []);
  const isMobileMode = useSelector(
    previewStore,
    (state) => state.context.isMobileMode,
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
  const publicationState = useSelector(
    previewStore,
    (state) => state.context.publicationState,
  );

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = React.useState(0);
  const [panelLeft, setPanelLeft] = React.useState(0);

  React.useEffect(() => {
    const el = wrapperRef.current?.parentElement;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setPanelWidth(rect.width);
      setPanelLeft(rect.left);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const sheetOverlap = Math.max(0, SHEET_WIDTH - panelLeft);
  const sheetOpenScale =
    panelWidth > 0 ? (panelWidth - sheetOverlap) / panelWidth : 1;

  React.useEffect(() => {
    const actions = [
      {
        id: "toggle-editing-panel",
        label: "Toggle editing panel",
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => previewStore.send({ type: "toggleSidebar" }),
        shortcut: { key: "e", withMeta: true },
        icon: "PanelRight",
      },
      {
        id: "toggle-lock-content",
        label: "Toggle lock content",
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => previewStore.send({ type: "toggleLockContent" }),
        icon: "Lock",
      },
      {
        id: "toggle-mobile-mode",
        label: "Toggle mobile mode",
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => previewStore.send({ type: "toggleMobileMode" }),
        shortcut: { key: "m" },
        icon: "TabletSmartphone",
      },
      {
        id: "switch-to-draft",
        label: "Switch to draft content",
        groupLabel: "Preview",
        checkIfAvailable: () => publicationState === "published",
        execute: () =>
          previewStore.send({ type: "setPublicationState", value: "draft" }),
        icon: "Edit3",
      },
      {
        id: "switch-to-published",
        label: "Switch to published content",
        groupLabel: "Preview",
        checkIfAvailable: () => publicationState === "draft",
        execute: () =>
          previewStore.send({
            type: "setPublicationState",
            value: "published",
          }),
        icon: "CheckCircle2",
      },
    ] satisfies Action[];

    actionsStore.send({ type: "registerManyActions", actions });

    return () => {
      actionsStore.send({
        type: "unregisterManyActions",
        ids: actions.map((a) => a.id),
      });
    };
  }, [publicationState]);

  return (
    <>
      <PanelContent className="relative overflow-hidden">
        <div
          ref={wrapperRef}
          className="absolute inset-0 transition-[transform,height] duration-500 ease-in-out will-change-transform"
          style={{
            height: isAnySideSheetOpen
              ? `${100 / sheetOpenScale}%`
              : "100%",
            transformOrigin: "top right",
            transform: isAnySideSheetOpen
              ? `scale(${sheetOpenScale})`
              : "scale(1)",
          }}
        >
          {isMobileMode ? (
            <div className="flex h-full justify-center checkered">
              <div className="border-2 mt-8 border-border rounded-sm shadow-xl relative w-[393px] h-[700px] overflow-hidden">
                <PreviewFrame
                  className="overflow-auto"
                  onIframeReady={handleIframeReady}
                >
                  {children}
                </PreviewFrame>
                <Overlays iframeElement={iframeElement} />
              </div>
              <FloatingToolbar />
            </div>
          ) : (
            <>
              <PreviewFrame
                className="w-full h-full checkered"
                onIframeReady={handleIframeReady}
              >
                {children}
              </PreviewFrame>
              <Overlays iframeElement={iframeElement} />
              <FloatingToolbar />
            </>
          )}
        </div>
      </PanelContent>
    </>
  );
};

export { PreviewPanel };
