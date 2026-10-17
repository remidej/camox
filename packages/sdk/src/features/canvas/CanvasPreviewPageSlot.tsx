import * as React from "react";
import { createPortal } from "react-dom";
import overlayStyles from "virtual:camox-overlay-css";

import { useEditingFrameClaim, useEditingOwner } from "../preview/editingFrame";
import { usePreviewPageFrame } from "../preview/previewPageFrame";
import { PreviewPreparationContext } from "../preview/previewPreparation";
import { ViewportContinuityContext } from "../preview/viewportContinuity";
import { useCanvasFrameMode } from "./canvasFrameMode";
import { CanvasOverlays } from "./CanvasOverlays";
import type { CanvasFrameActivate } from "./CanvasPageFrame";
import { CanvasWorkspaceContext } from "./canvasZoom";

/**
 * The selected Page's place in the Canvas row, where the Preview's own page
 * frame shows instead of a frame of the Canvas. Edit Mode then never remounts
 * the page, and neither does deselecting it, which keeps it in the frame. The slot takes the frame's height, and draws the Canvas overlays
 * over it.
 */
export function CanvasPreviewPageSlot({
  pageId,
  derivedLayoutId,
  width,
  viewportHeight,
  selected,
  hovered,
  onActivate,
}: {
  pageId?: string;
  derivedLayoutId?: string;
  width: number;
  viewportHeight: number;
  /** Whether the Page is selected. Once deselected, it keeps the frame, like a frame of the Canvas. */
  selected: boolean;
  hovered: boolean;
  onActivate: CanvasFrameActivate;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  // Like a Canvas frame, it edits its derived layout, or the Page itself.
  const owner = useEditingOwner({ pageId, layoutId: derivedLayoutId });
  const workspace = React.use(CanvasWorkspaceContext);
  const preparation = React.use(PreviewPreparationContext);
  const continuity = React.use(ViewportContinuityContext);
  const { frame, slot, inCanvas, height, overlays, iframe } = usePreviewPageFrame();
  const mode = useCanvasFrameMode({ near: true, selected });
  // It claims the frame for the Canvas, apart from the Preview's own claim on it.
  const claim = useEditingFrameClaim(iframe, owner);
  const activateOwner = React.useEffectEvent((source: "selection" | "interaction") => {
    if (!owner) return;
    onActivate(owner, source, claim());
  });
  // A stable handler: the slot effect below compares it to skip redundant updates.
  // oxlint-disable-next-line react/preserve-manual-memoization -- wraps an effect event, which has no dependency
  const onInteract = React.useCallback(() => activateOwner("interaction"), []);

  // The slot's place in the row: the Canvas items lay out without transforms, but
  // re-lay out without rerendering the slot, so it is measured after every render.
  React.useLayoutEffect(() => {
    const element = ref.current;
    const viewport = element?.closest<HTMLElement>("[data-camox-canvas]");
    if (!frame || !element || !viewport) return;
    const next = {
      viewport,
      left: element.offsetLeft,
      top: element.offsetTop,
      width,
      viewportHeight,
      mode,
      workspace,
      onInteract,
    };
    const current = frame.getSnapshot().slot;
    const unchanged =
      current &&
      (Object.keys(next) as (keyof typeof next)[]).every((key) => current[key] === next[key]);
    if (!unchanged) frame.setSlot(next);
  });
  React.useLayoutEffect(() => {
    if (!frame) return;
    return () => frame.setSlot(null);
  }, [frame]);

  // Its content is already rendered, so the Canvas is ready once the slot is
  // laid out. The viewport handed over from the Preview is restored once the
  // frame is measured here.
  const laidOut = slot !== null;
  React.useEffect(() => {
    if (laidOut) preparation?.ready({ restore: false });
  }, [laidOut, preparation]);
  const placed = inCanvas && height > 0;
  React.useLayoutEffect(() => {
    if (placed) continuity?.restoreCanvas();
  }, [placed, continuity]);

  React.useEffect(() => {
    if (!placed || !owner || !selected) return;
    // Only becoming placed or selected takes ownership, as with a frame of the Canvas.
    activateOwner("selection");
  }, [placed, owner, selected]);
  const document = placed ? (iframe?.contentDocument ?? null) : null;
  return (
    <div
      ref={ref}
      data-canvas-preview-page-slot
      style={{ width, height: placed ? height : undefined, minHeight: viewportHeight }}
    >
      {overlays &&
        document &&
        createPortal(
          <CanvasOverlays
            document={document}
            activate={onInteract}
            pageHovered={hovered}
            canAddBlocks={owner?.kind === "page"}
          >
            <style>{overlayStyles}</style>
            <div style={{ width, height }} />
          </CanvasOverlays>,
          overlays,
        )}
    </div>
  );
}
