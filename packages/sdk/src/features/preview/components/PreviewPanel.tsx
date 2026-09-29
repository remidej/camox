import { PanelContent } from "@camox/ui/panel";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { checkIfInputFocused, cn } from "@/lib/utils";

import { BlockEditingRuntimeProvider } from "../../../core/editing/BlockEditingRuntime";
import { actionsStore } from "../../provider/actionsStore";
import { SharedChromeContext } from "../../runtime/SharedChromeContext";
import { PreviewEditingOwnerContext } from "../previewSelection";
import { previewStore, type EditingOwner, type ViewportMode } from "../previewStore";
import { useBlockActionsShortcuts } from "./BlockActionsPopover";
import { FieldOverlayStyles } from "./FieldOverlayStyles";
import { Frame, useFrame } from "./Frame";
import { MobilePreviewDrawer } from "./MobilePreviewDrawer";
import { OverlayTracker } from "./OverlayTracker";
import type { PreviewedPage } from "./PageNavigatorSidebar";
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
      <KeyDownForwarder />
    </Frame>
  );
};

/** Shared by the single-page preview and each canvas document. */
export const PreviewFrameEffects = () => {
  return (
    <>
      <FieldOverlayStyles />
      <KeyDownForwarder />
      <OverlayTracker />
    </>
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
        // unless it's Escape or a modified shortcut (meta/alt) that isn't Backspace
        const userIsTyping = checkIfInputFocused(iframeWindow.document);
        if (userIsTyping) {
          if (
            action.shortcut.key !== "Escape" &&
            !action.shortcut.withMeta &&
            !action.shortcut.withAlt
          )
            return false;
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
        if (e.key === "Escape" && checkIfInputFocused(iframeWindow.document)) {
          (iframeWindow.document.activeElement as HTMLElement).blur();
        }
        iframeWindow.parent.postMessage(
          {
            type: "executeAction",
            actionId: matchingAction.id,
          },
          "*",
        );
      }
    };

    const handleCapturedKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") return;
      handleKeyDown(event);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      handleKeyDown(event);
    };

    // Consume shortcuts before preview editors can turn Enter into a line break,
    // but leave Escape to local handlers before forwarding it.
    iframeWindow.addEventListener("keydown", handleCapturedKeyDown, true);
    iframeWindow.addEventListener("keydown", handleEscape);
    return () => {
      iframeWindow.removeEventListener("keydown", handleCapturedKeyDown, true);
      iframeWindow.removeEventListener("keydown", handleEscape);
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
  active?: boolean;
  isMobileExperience?: boolean;
  page?: PreviewedPage;
  layoutId?: number;
  projectName?: string;
  toolbarProps?: React.ComponentProps<typeof PreviewToolbar>;
}

export function CuratedBlockShortcuts() {
  useBlockActionsShortcuts();
  return null;
}

const PreviewPanel = ({
  children,
  active = true,
  isMobileExperience = false,
  page,
  layoutId,
  projectName = "Project",
  toolbarProps,
}: PreviewPanelProps) => {
  const sharedChrome = React.useContext(SharedChromeContext);
  const pageId = page?.id;
  const owner = React.useMemo<EditingOwner | null>(() => {
    if (pageId != null) return { kind: "page", pageId };
    if (layoutId != null) return { kind: "layout", layoutId };
    return null;
  }, [pageId, layoutId]);
  const activeRef = React.useRef(active);
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  React.useLayoutEffect(() => {
    activeRef.current = active;
    return () => {
      activeRef.current = false;
    };
  }, [active]);
  React.useLayoutEffect(() => {
    if (!active) return;
    if (iframeRef.current) {
      previewStore.send({ type: "setIframeElement", element: iframeRef.current });
    }
    if (owner?.kind === "layout") {
      previewStore.send({ type: "activateLayout", layoutId: owner.layoutId });
      return;
    }
    previewStore.send({ type: "activatePage", pageId: owner?.pageId ?? null });
  }, [active, owner]);
  const handleIframeReady = React.useCallback((element: HTMLIFrameElement) => {
    iframeRef.current = element;
    // A retained frame can finish loading after Canvas has taken ownership.
    if (!activeRef.current) return;
    previewStore.send({ type: "setIframeElement", element });
  }, []);
  const viewportMode = useSelector(previewStore, (state) => state.context.viewportMode);
  const isToolbarHidden = useSelector(previewStore, (state) => state.context.isToolbarHidden);
  // Keep the same boundary from the initial render so mode changes never enable
  // editing in this tree or remount the retained page while Canvas prepares.
  const readOnlyChildren = (
    <BlockEditingRuntimeProvider runtime={null}>{children}</BlockEditingRuntimeProvider>
  );

  if (isMobileExperience) {
    return (
      <PreviewEditingOwnerContext value={owner}>
        <PanelContent className="flex min-h-0 flex-col overflow-hidden bg-black">
          <div className="relative min-h-0 flex-1">
            <PreviewFrame className="h-full w-full" onIframeReady={handleIframeReady}>
              {readOnlyChildren}
            </PreviewFrame>
          </div>
          {active &&
            !isToolbarHidden &&
            (page ? (
              <MobilePreviewDrawer page={page} projectName={projectName} />
            ) : (
              !sharedChrome && <PreviewToolbar {...toolbarProps} />
            ))}
        </PanelContent>
      </PreviewEditingOwnerContext>
    );
  }

  return (
    <PreviewEditingOwnerContext value={owner}>
      <PanelContent className="relative overflow-hidden bg-black">
        <div className="absolute inset-0">
          {viewportMode === "full" ? (
            <PreviewFrame className="checkered h-full w-full" onIframeReady={handleIframeReady}>
              {readOnlyChildren}
            </PreviewFrame>
          ) : (
            <div className="checkered flex h-full items-center justify-center">
              <div className={cn("relative overflow-hidden", viewportClassName[viewportMode])}>
                <PreviewFrame className="overflow-auto" onIframeReady={handleIframeReady}>
                  {readOnlyChildren}
                </PreviewFrame>
              </div>
            </div>
          )}
          {active && !sharedChrome && <PreviewToolbar {...toolbarProps} />}
        </div>
      </PanelContent>
    </PreviewEditingOwnerContext>
  );
};

export { PreviewPanel };
