import { PanelContent } from "@camox/ui/panel";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { checkIfInputFocused, cn } from "@/lib/utils";

import type { Action } from "../../provider/actionsStore";
import { actionsStore } from "../../provider/actionsStore";
import { SharedChromeContext } from "../../runtime/SharedChromeContext";
import { areCommentsEnabled } from "../commentsEnabled";
import { PreviewPageContext } from "../previewSelection";
import {
  previewStore,
  selectIsCommentMode,
  selectIsEditMode,
  type ViewportMode,
} from "../previewStore";
import { useBlockActionsShortcuts } from "./BlockActionsPopover";
import { FieldOverlayStyles } from "./FieldOverlayStyles";
import { FieldToolbar } from "./FieldToolbar";
import { Frame, useFrame } from "./Frame";
import { MobilePreviewDrawer } from "./MobilePreviewDrawer";
import { Overlays } from "./Overlays";
import { OverlayTracker } from "./OverlayTracker";
import type { PreviewedPage } from "./PageNavigatorSidebar";
import { PreviewComments } from "./PreviewComments";
import { PreviewToolbar } from "./PreviewToolbar";

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
      <FieldOverlayStyles />
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
        const isKeyMatching =
          withAlt && key.length === 1 && /[a-z]/i.test(key)
            ? e.code === `Key${key.toUpperCase()}`
            : key.toLowerCase() === e.key.toLowerCase();

        return (
          isKeyMatching &&
          !!withMeta === (e.metaKey || e.ctrlKey) &&
          !!withAlt === e.altKey &&
          !!withShift === e.shiftKey
        );
      });

      // Only forward if there's a matching action
      if (matchingAction) {
        e.preventDefault();
        e.stopPropagation();
        iframeWindow.parent.postMessage(
          {
            type: "executeAction",
            actionId: matchingAction.id,
          },
          "*",
        );
      }
    };

    // Consume shortcuts before preview editors can turn Enter into a line break.
    iframeWindow.addEventListener("keydown", handleKeyDown, true);
    return () => {
      iframeWindow.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [iframeWindow, actions]);

  return null;
};

/* -------------------------------------------------------------------------------------------------
 * PreviewPanel
 * -----------------------------------------------------------------------------------------------*/

const viewportClassName: Record<Exclude<ViewportMode, "full">, string> = {
  tablet: "h-[1024px] w-[768px] max-h-full max-w-full",
  mobile: "h-175 w-[393px] max-h-full max-w-full",
};

interface PreviewPanelProps {
  children: React.ReactNode;
  isMobileExperience?: boolean;
  page?: PreviewedPage;
  projectName?: string;
  toolbarProps?: React.ComponentProps<typeof PreviewToolbar>;
}

function CuratedBlockShortcuts() {
  useBlockActionsShortcuts();
  return null;
}

const PreviewPanel = ({
  children,
  isMobileExperience = false,
  page,
  projectName = "Project",
  toolbarProps,
}: PreviewPanelProps) => {
  const sharedChrome = React.useContext(SharedChromeContext);
  const previewContent = (
    <PreviewPageContext value={page?.id ?? null}>{children}</PreviewPageContext>
  );
  const iframeElement = useSelector(previewStore, (state) => state.context.iframeElement);
  const handleIframeReady = React.useCallback((element: HTMLIFrameElement) => {
    previewStore.send({ type: "setIframeElement", element });
  }, []);
  const viewportMode = useSelector(previewStore, (state) => state.context.viewportMode);
  const isEditMode = useSelector(previewStore, selectIsEditMode);
  const isCommentMode = useSelector(previewStore, selectIsCommentMode);
  const isToolbarHidden = useSelector(previewStore, (state) => state.context.isToolbarHidden);
  React.useEffect(() => {
    const actions = [
      {
        id: "cycle-viewport-mode",
        label: "Cycle viewport mode",
        aliases: ["Responsive preview", "Viewport preview", "Device preview"],
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => previewStore.send({ type: "cycleViewportMode" }),
        shortcut: { key: "m" },
      },
      {
        id: "set-viewport-full",
        label: "Set full viewport",
        aliases: ["Full preview", "Desktop preview", "Full width preview"],
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => previewStore.send({ type: "setViewportMode", mode: "full" }),
      },
      {
        id: "set-viewport-tablet",
        label: "Set tablet viewport",
        aliases: ["Tablet preview", "Responsive preview"],
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => previewStore.send({ type: "setViewportMode", mode: "tablet" }),
      },
      {
        id: "set-viewport-mobile",
        label: "Set mobile viewport",
        aliases: ["Mobile preview", "Phone preview", "Responsive preview"],
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => previewStore.send({ type: "setViewportMode", mode: "mobile" }),
      },
      {
        id: "clear-selection",
        label: "Clear selection",
        aliases: ["Deselect", "Unselect"],
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => {
          previewStore.send({ type: "clearSelection" });
        },
        shortcut: { key: "Escape" },
      },
    ] satisfies Action[];

    actionsStore.send({ type: "registerManyActions", actions });

    return () => {
      actionsStore.send({
        type: "unregisterManyActions",
        ids: actions.map((a) => a.id),
      });
    };
  }, []);

  if (isMobileExperience) {
    return (
      <PanelContent className="flex min-h-0 flex-col overflow-hidden bg-black">
        <div className="relative min-h-0 flex-1">
          <PreviewFrame className="h-full w-full" onIframeReady={handleIframeReady}>
            {previewContent}
          </PreviewFrame>
        </div>
        {!isToolbarHidden &&
          (page ? (
            <MobilePreviewDrawer page={page} projectName={projectName} />
          ) : (
            !sharedChrome && <PreviewToolbar {...toolbarProps} />
          ))}
      </PanelContent>
    );
  }

  return (
    <>
      {page && !isCommentMode && <CuratedBlockShortcuts />}
      {areCommentsEnabled() && page && <PreviewComments key={page.id} />}
      <PanelContent className="relative overflow-hidden bg-black">
        <div className="absolute inset-0">
          {viewportMode === "full" ? (
            <>
              <PreviewFrame className="checkered h-full w-full" onIframeReady={handleIframeReady}>
                {previewContent}
              </PreviewFrame>
              {isEditMode && !isCommentMode && (
                <Overlays iframeElement={iframeElement} canAddBlocks={!!page} />
              )}
              {isEditMode && !isCommentMode && <FieldToolbar />}
              {!sharedChrome && <PreviewToolbar {...toolbarProps} />}
            </>
          ) : (
            <div
              className={cn(
                "checkered flex h-full justify-center",
                isEditMode ? "items-start" : "items-center",
              )}
            >
              <div
                className={cn(
                  "relative overflow-hidden",
                  viewportClassName[viewportMode],
                  isEditMode && "mt-8",
                )}
              >
                <PreviewFrame className="overflow-auto" onIframeReady={handleIframeReady}>
                  {previewContent}
                </PreviewFrame>
                {isEditMode && !isCommentMode && (
                  <Overlays iframeElement={iframeElement} canAddBlocks={!!page} />
                )}
              </div>
              {isEditMode && !isCommentMode && <FieldToolbar />}
              {!sharedChrome && <PreviewToolbar {...toolbarProps} />}
            </div>
          )}
        </div>
      </PanelContent>
    </>
  );
};

export { PreviewPanel };
