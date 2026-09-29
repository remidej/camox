import { Button } from "@camox/ui/button";
import { useSelector } from "@xstate/store-react";
import { PlusIcon } from "lucide-react";
import * as React from "react";

import { postOverlayMessage } from "../preview/overlayMessages";
import { previewStore, selectIsCommentMode, selectIsEditMode } from "../preview/previewStore";
import { canvasInsertionSeams } from "./canvasInsertionSeams";
import {
  observeCanvasOverlays,
  type CanvasOverlayTarget,
  type OverlayRect,
} from "./canvasOverlayGeometry";

/** Geometry stays in page coordinates. CSS projects it through the camera without
 * measuring the page or rerendering React during pan/zoom. */
export function canvasOverlayStyle(rect: OverlayRect): React.CSSProperties {
  return {
    position: "absolute",
    left: `calc(${rect.x}px * var(--canvas-zoom, 1))`,
    top: `calc(${rect.y}px * var(--canvas-zoom, 1))`,
    width: `calc(${rect.width}px * var(--canvas-zoom, 1))`,
    height: `calc(${rect.height}px * var(--canvas-zoom, 1))`,
  };
}

export function CanvasOverlays({
  document,
  activate,
  canAddBlocks = false,
  children,
}: {
  document: Document | null;
  activate: () => void;
  canAddBlocks?: boolean;
  children: React.ReactNode;
}) {
  const [targets, setTargets] = React.useState<CanvasOverlayTarget[]>([]);
  const isEditMode = useSelector(previewStore, selectIsEditMode);
  const isCommentMode = useSelector(previewStore, selectIsCommentMode);
  const enabled = isEditMode && !isCommentMode;
  // The frame installs its sizing observer in a layout effect first. Registering
  // afterward keeps content-triggered measurements behind that sizing pass.
  React.useEffect(() => {
    if (!document) return;
    return observeCanvasOverlays(document, setTargets);
  }, [document]);
  const seams = canAddBlocks ? canvasInsertionSeams(targets) : [];

  return (
    <div style={{ position: "relative" }}>
      {children}
      <div
        className="camox-canvas-overlays"
        data-canvas-overlays
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "calc(100% * var(--canvas-zoom, 1))",
          height: 0,
          zIndex: 10,
          pointerEvents: "none",
          display: enabled ? "var(--canvas-overlays-display, block)" : "none",
          transform: "scale(calc(1 / var(--canvas-zoom, 1)))",
          transformOrigin: "0 0",
        }}
      >
        {targets.flatMap((target, index) =>
          target.hovered || target.focused
            ? target.rects.map((rect, fragment) => (
                <div
                  key={`${index}:${fragment}`}
                  className="camox-canvas-outline"
                  data-camox-highlight-focused={target.focused || undefined}
                  data-camox-inline={target.inline || undefined}
                  data-camox-overlay-mode={target.synced ? "synced" : undefined}
                  style={canvasOverlayStyle(rect)}
                />
              ))
            : [],
        )}
        {enabled &&
          seams.map((seam) => (
            <div
              key={seam.key}
              data-canvas-overlay-control
              data-canvas-insertion-seam={seam.key}
              className="group/seam flex items-center justify-center"
              style={{
                position: "absolute",
                left: 0,
                top: `calc(${seam.y}px * var(--canvas-zoom, 1))`,
                // Span the displayed page width, keeping the hit-area height in Studio pixels.
                width: "100%",
                height: 40,
                transform: "translateY(-50%)",
                pointerEvents: "auto",
              }}
            >
              <Button
                size="xs"
                className="text-white opacity-0 shadow-sm group-focus-within/seam:opacity-100 group-hover/seam:opacity-100"
                style={{ backgroundColor: "var(--camox-overlay-color-selected)" }}
                onClick={(event) => {
                  event.stopPropagation();
                  activate();
                  postOverlayMessage(seam.request);
                }}
              >
                <PlusIcon />
                Add block
              </Button>
            </div>
          ))}
      </div>
    </div>
  );
}
