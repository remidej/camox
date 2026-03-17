import { useSelector } from "@xstate/store/react";
import * as React from "react";

import { Frame, useFrame } from "@/components/ui/frame";
import { PanelContent } from "@/components/ui/panel";
import { checkIfInputFocused } from "@/lib/utils";

import type { Action } from "../../provider/actionsStore";
import { actionsStore } from "../../provider/actionsStore";
import { SHEET_WIDTH } from "../previewConstants";
import { previewStore } from "../previewStore";
import { useBlockActionsShortcuts } from "./BlockActionsPopover";
import { Overlays } from "./Overlays";
import { OverlayTracker } from "./OverlayTracker";
import { useIsPreviewSheetOpen } from "./PreviewSideSheet";
import { PreviewToolbar } from "./PreviewToolbar";
import { TextFormatToolbar } from "./TextFormatToolbar";

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
    if (!iframeWindow || !iframeWindow.parent || iframeWindow.parent === iframeWindow) {
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
          !!withMeta === (e.metaKey || e.ctrlKey) &&
          !!withAlt === e.altKey &&
          !!withShift === e.shiftKey
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

  const iframeElement = useSelector(previewStore, (state) => state.context.iframeElement);
  const handleIframeReady = React.useCallback((element: HTMLIFrameElement) => {
    previewStore.send({ type: "setIframeElement", element });
  }, []);
  const isMobileMode = useSelector(previewStore, (state) => state.context.isMobileMode);
  const isAgentChatSheetOpen = useSelector(
    previewStore,
    (state) => state.context.isAgentChatSheetOpen,
  );
  const isAnySideSheetOpen = useIsPreviewSheetOpen();
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
  const sheetOpenScale = panelWidth > 0 ? (panelWidth - sheetOverlap) / panelWidth : 1;

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
        id: "open-agent-chat",
        label: "Ask for changes",
        groupLabel: "Preview",
        checkIfAvailable: () => !isAgentChatSheetOpen,
        execute: () => previewStore.send({ type: "openAgentChatSheet" }),
        shortcut: { key: "i", withMeta: true },
        icon: "MessageSquare",
      },
    ] satisfies Action[];

    actionsStore.send({ type: "registerManyActions", actions });

    return () => {
      actionsStore.send({
        type: "unregisterManyActions",
        ids: actions.map((a) => a.id),
      });
    };
  }, [isAgentChatSheetOpen]);

  return (
    <>
      <PanelContent className="relative overflow-hidden">
        <div
          ref={wrapperRef}
          className="absolute inset-0 transition-[transform,height] duration-500 ease-in-out will-change-transform"
          style={{
            height: isAnySideSheetOpen ? `${100 / sheetOpenScale}%` : "100%",
            transformOrigin: "top right",
            transform: isAnySideSheetOpen ? `scale(${sheetOpenScale})` : "scale(1)",
          }}
        >
          {isMobileMode ? (
            <div className="checkered flex h-full justify-center">
              <div className="relative mt-8 h-[700px] w-[393px] overflow-hidden">
                <PreviewFrame className="overflow-auto" onIframeReady={handleIframeReady}>
                  {children}
                </PreviewFrame>
                <Overlays iframeElement={iframeElement} />
              </div>
              <TextFormatToolbar />
              <PreviewToolbar />
            </div>
          ) : (
            <>
              <PreviewFrame className="checkered h-full w-full" onIframeReady={handleIframeReady}>
                {children}
              </PreviewFrame>
              <Overlays iframeElement={iframeElement} />
              <TextFormatToolbar />
              <PreviewToolbar />
            </>
          )}
        </div>
      </PanelContent>
    </>
  );
};

export { PreviewPanel };
