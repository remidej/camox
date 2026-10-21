import { PanelContent } from "@camox/ui/panel";
import { useSelector } from "@xstate/store-react";
import * as React from "react";
import { flushSync } from "react-dom";

import { checkIfInputFocused, cn } from "@/lib/utils";

import { ArtifactStudioContext } from "../../../core/hooks/useArtifactHost";
import { EditableSurfaceContext } from "../../../core/hooks/useIsEditable";
import { adoptCanvasDocument, pauseCanvasDocument } from "../../canvas/canvasFrameDocument";
import { CanvasWorkspaceContext } from "../../canvas/canvasZoom";
import { forwardCanvasWheel, useCanvasFrameInput } from "../../canvas/useCanvasFrameInput";
import {
  type LocationState,
  NavigationDisabled,
  NavigationLocation,
} from "../../navigation/navigation";
import { actionsStore } from "../../provider/actionsStore";
import { useEditingFrameClaim, useEditingOwner } from "../editingFrame";
import {
  PREVIEW_PAGE_Z_INDEX,
  previewPageIframeProps,
  usePreviewPageFrame,
  type PreviewPageSlot,
} from "../previewPageFrame";
import { PreviewEditingOwnerContext } from "../previewSelection";
import { previewStore, type EditingOwner, type ViewportMode } from "../previewStore";
import { useBlockActionsShortcuts } from "./BlockActionsPopover";
import { FieldOverlayStyles } from "./FieldOverlayStyles";
import { Frame, useFrame } from "./Frame";
import { MobilePreviewDrawer } from "./MobilePreviewDrawer";
import { Overlays } from "./Overlays";
import { OverlayTracker } from "./OverlayTracker";
import type { PreviewedPage } from "./PageNavigatorHeader";

/* -------------------------------------------------------------------------------------------------
 * Frame
 * -----------------------------------------------------------------------------------------------*/

export const PreviewFrame = ({
  children,
  style,
  className,
  iframeProps,
  inCanvas,
  onIframeReady,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  iframeProps?: Record<string, string>;
  inCanvas?: boolean;
  onIframeReady?: (iframe: HTMLIFrameElement) => void;
}) => {
  return (
    <Frame
      className={className}
      style={style}
      iframeProps={iframeProps}
      inCanvas={inCanvas}
      onIframeReady={onIframeReady}
    >
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

/** The preview's read-only tree is never editable, whether or not the Canvas shows. */
const READ_ONLY_ARTIFACT_STUDIO = { editing: false, canvas: false };

const viewportClassName: Record<Exclude<ViewportMode, "full">, string> = {
  tablet: "h-[1024px] w-[768px] max-h-full max-w-full",
  mobile: "h-175 w-[393px] max-h-full max-w-full",
};

interface PreviewPanelProps {
  children: React.ReactNode;
  active?: boolean;
  isMobileExperience?: boolean;
  page?: PreviewedPage;
  layoutId?: string;
  /** Where the page renders, when not at the current location. */
  pageLocation?: LocationState;
  projectName?: string;
}

export function CuratedBlockShortcuts() {
  useBlockActionsShortcuts();
  return null;
}

/**
 * What the Preview page frame does while it shows in the Canvas, like any Canvas
 * frame: it takes its slot's size, keeps the camera's input, activates its Page
 * when used, pauses with the camera, and draws its editing overlays.
 */
function PreviewPageCanvasEffects({ owner }: { owner: EditingOwner | null }) {
  const { window: frameWindow, iframeElement } = useFrame();
  const { frame, slot, inCanvas } = usePreviewPageFrame();
  const iframeRef = React.useRef(iframeElement);
  // Set before the frame input effect below reads it.
  React.useLayoutEffect(() => {
    iframeRef.current = iframeElement;
  });
  const root = frameWindow?.document.querySelector<HTMLElement>("[data-camox-preview-root]");
  const placed = inCanvas && slot && iframeElement && root ? slot : null;
  const viewportHeight = placed?.viewportHeight;
  React.useLayoutEffect(() => {
    if (!frame || !iframeElement || !root || viewportHeight === undefined) return;
    const undo = adoptCanvasDocument(iframeElement, root, viewportHeight);
    // The exact height: rounding it would size the slot under the frame a sliver taller.
    const report = () =>
      frame.setHeight(
        Number.parseFloat(
          iframeElement.ownerDocument.defaultView!.getComputedStyle(iframeElement).height,
        ),
      );
    // The first height places the frame before paint. Later ones resize the slot, which
    // the camera observes too, so they wait for the next frame rather than loop observers.
    report();
    let pending = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(report);
    });
    resize.observe(iframeElement);
    return () => {
      cancelAnimationFrame(pending);
      resize.disconnect();
      undo();
    };
  }, [frame, iframeElement, root, viewportHeight]);
  const live = !placed || placed.mode === "live";
  React.useEffect(() => {
    if (live || !root) return;
    return pauseCanvasDocument(root.ownerDocument);
  }, [live, root]);
  useCanvasFrameInput(iframeRef, placed ? (root ?? null) : null, placed?.viewport);
  const onInteract = placed?.onInteract;
  React.useEffect(() => {
    const doc = root?.ownerDocument;
    if (!doc || !onInteract) return;
    // Frame links never navigate the Canvas; the Preview's own handler respects this.
    const preventLinkNavigation = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.("a")) event.preventDefault();
    };
    for (const type of ["pointerdown", "focusin", "click"])
      doc.addEventListener(type, onInteract, true);
    doc.addEventListener("click", preventLinkNavigation);
    return () => {
      for (const type of ["pointerdown", "focusin", "click"])
        doc.removeEventListener(type, onInteract, true);
      doc.removeEventListener("click", preventLinkNavigation);
    };
  }, [root, onInteract]);
  React.useEffect(() => {
    if (!frame || !iframeElement) return;
    frame.setIframe(iframeElement);
    return () => frame.setIframe(null);
  }, [frame, iframeElement]);
  if (!placed) return null;
  return (
    <>
      <FieldOverlayStyles />
      <OverlayTracker />
      <Overlays frame={iframeElement} owner={owner} canAddBlocks={owner?.kind === "page"} />
    </>
  );
}

const PreviewPanel = ({
  children,
  active = true,
  isMobileExperience = false,
  page,
  layoutId,
  pageLocation,
  projectName = "Project",
}: PreviewPanelProps) => {
  // The Preview gets either a curated Page or a derived layout, never both.
  const owner = useEditingOwner({ pageId: page?.id, layoutId });
  const [iframe, setIframe] = React.useState<HTMLIFrameElement | null>(null);
  const claim = useEditingFrameClaim(iframe, owner);
  // Under the Canvas, its frames claim instead, and the Preview claims again once shown.
  React.useLayoutEffect(() => {
    if (active) claim();
  }, [active, owner, claim]);
  const viewportMode = useSelector(previewStore, (state) => state.context.viewportMode);
  const isToolbarHidden = useSelector(previewStore, (state) => state.context.isToolbarHidden);
  const { frame, slot, inCanvas, revealed } = usePreviewPageFrame();
  const placed = !isMobileExperience && inCanvas ? slot : null;
  // Under the Canvas, the Preview only shows its frame, in the selected Page's slot.
  const underCanvas = revealed && !isMobileExperience;
  const overlaysRef = React.useCallback(
    (element: HTMLDivElement | null) => frame?.setOverlays(element),
    [frame],
  );
  // The same tree in every placement, so toggling the Canvas never remounts the page: the
  // editing runtime stays, and only the selected Page's placement makes it editable.
  const pageContent = (
    <NavigationLocation location={pageLocation}>
      <EditableSurfaceContext value={!!placed?.selected}>
        <CanvasWorkspaceContext value={placed?.workspace ?? null}>
          {/* Like any Canvas frame, it never navigates the Studio from the Canvas. */}
          <NavigationDisabled disabled={!!placed}>
            <ArtifactStudioContext value={READ_ONLY_ARTIFACT_STUDIO}>
              {children}
            </ArtifactStudioContext>
            <PreviewPageCanvasEffects owner={owner} />
          </NavigationDisabled>
        </CanvasWorkspaceContext>
      </EditableSurfaceContext>
    </NavigationLocation>
  );

  if (isMobileExperience) {
    return (
      <PreviewEditingOwnerContext value={owner}>
        <PanelContent className="flex min-h-0 flex-col overflow-hidden bg-black">
          <div className="relative min-h-0 flex-1">
            <PreviewFrame className="h-full w-full" onIframeReady={setIframe}>
              {pageContent}
            </PreviewFrame>
          </div>
          {active && !isToolbarHidden && page && (
            <MobilePreviewDrawer page={page} projectName={projectName} />
          )}
        </PanelContent>
      </PreviewEditingOwnerContext>
    );
  }

  const device = viewportMode !== "full" && !placed;
  return (
    <PreviewEditingOwnerContext value={owner}>
      <PanelContent className={cn("relative overflow-hidden", !underCanvas && "bg-black")}>
        <PreviewPageClip
          slot={placed}
          className={cn(
            "absolute",
            !placed && "inset-0",
            underCanvas && (!placed || placed.hidden) && "invisible",
            device && "checkered flex items-center justify-center",
          )}
        >
          <div
            data-preview-page-host
            className={cn(
              // Promoted like the Canvas row, by the camera painting onto the clip.
              placed && "absolute top-0 left-0 in-data-[canvas-promoted]:will-change-transform",
              !placed && !device && "h-full w-full",
              device && cn("relative overflow-hidden", viewportClassName[viewportMode]),
            )}
            style={
              placed
                ? {
                    width: placed.width,
                    // The camera paints its variables onto the clip, like onto the viewport.
                    transform: `translate(calc(var(--canvas-x, 0px) + ${placed.left}px * var(--canvas-zoom, 1)), calc(var(--canvas-y, 0px) + ${placed.top}px * var(--canvas-zoom, 1))) scale(var(--canvas-zoom, 1))`,
                    transformOrigin: "0 0",
                  }
                : undefined
            }
          >
            <PreviewFrame
              className={cn(
                !placed && !device && "checkered h-full w-full",
                device && "overflow-auto",
              )}
              iframeProps={previewPageIframeProps}
              inCanvas={!!placed}
              onIframeReady={setIframe}
            >
              {pageContent}
            </PreviewFrame>
            <div
              ref={overlaysRef}
              data-preview-page-overlays
              className="pointer-events-none absolute inset-0"
              hidden={!placed}
            />
          </div>
        </PreviewPageClip>
      </PanelContent>
    </PreviewEditingOwnerContext>
  );
};

/**
 * Fills the Preview, or clips the frame to the Canvas viewport above the Canvas
 * row, where the camera moves it. Space + drag pans through it, and wheel input
 * over its overlays moves the camera like over the rest of the Canvas.
 */
function PreviewPageClip({
  slot,
  className,
  children,
}: {
  slot: PreviewPageSlot | null;
  className: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [rect, setRect] = React.useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const viewport = slot?.viewport;
  const mirrorCamera = slot?.workspace?.mirrorCamera;
  React.useLayoutEffect(() => {
    const clip = ref.current;
    const parent = clip?.offsetParent;
    if (!clip || !parent || !viewport) {
      setRect(null);
      return;
    }
    const measure = () => {
      const from = parent.getBoundingClientRect();
      const to = viewport.getBoundingClientRect();
      setRect({
        left: to.left - from.left,
        top: to.top - from.top,
        width: to.width,
        height: to.height,
      });
    };
    measure();
    // Observers run before paint, but a plain state update renders after it, which
    // would show the frame one frame off wherever the Canvas viewport moved.
    const resize = new ResizeObserver(() => flushSync(measure));
    resize.observe(viewport);
    resize.observe(parent);
    return () => resize.disconnect();
  }, [viewport]);
  React.useLayoutEffect(() => {
    const clip = ref.current;
    if (!clip || !mirrorCamera) return;
    return mirrorCamera(clip);
  }, [mirrorCamera]);
  // The frame forwards its own wheel input; this covers the overlays drawn over it.
  React.useEffect(() => {
    const clip = ref.current;
    if (!clip || !viewport) return;
    return forwardCanvasWheel(clip, viewport);
  }, [viewport]);
  return (
    <div
      ref={ref}
      data-preview-page-clip
      className={cn(
        className,
        slot &&
          "overflow-clip data-[canvas-pan]:pointer-events-none data-[canvas-pan]:**:pointer-events-none",
      )}
      style={slot && rect ? { ...rect, zIndex: PREVIEW_PAGE_Z_INDEX } : undefined}
    >
      {children}
    </div>
  );
}

export { PreviewPanel };
