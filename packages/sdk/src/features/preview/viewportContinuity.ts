import * as React from "react";

import type { CanvasCamera } from "../canvas/canvasCamera";

/** A reading position, never an editing selection. Block IDs survive reflow. */
export interface ViewportAnchor {
  blockId?: string;
  offset: number;
  y: number;
}

const blockSelector = "[data-camox-viewport-block]";

export function captureViewportAnchor(doc: Document, y: number): ViewportAnchor {
  const scroll = doc.scrollingElement?.scrollTop ?? 0;
  const blocks = Array.from(doc.querySelectorAll<HTMLElement>(blockSelector));
  const block = blocks.find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.height > 0 && rect.top + scroll <= y && rect.bottom + scroll > y;
  });
  if (!block) return { y, offset: 0 };
  return {
    blockId: block.getAttribute("data-camox-viewport-block")!,
    offset: y - block.getBoundingClientRect().top - scroll,
    y,
  };
}

function anchorBlock(doc: Document, anchor: ViewportAnchor) {
  return Array.from(doc.querySelectorAll<HTMLElement>(blockSelector)).find(
    (element) => element.getAttribute("data-camox-viewport-block") === anchor.blockId,
  );
}

export function resolveViewportAnchor(doc: Document, anchor: ViewportAnchor) {
  const block = anchorBlock(doc, anchor);
  if (!block) return anchor.y;
  const rect = block.getBoundingClientRect();
  return rect.top + (doc.scrollingElement?.scrollTop ?? 0) + Math.min(anchor.offset, rect.height);
}

function previewViewportY(doc: Document, scroll: HTMLElement) {
  return (
    (doc.scrollingElement?.scrollTop ?? 0) +
    (scroll === doc.scrollingElement ? 0 : Math.max(0, scroll.getBoundingClientRect().top))
  );
}

export function capturePreviewAnchor(doc: Document, scroll: HTMLElement): ViewportAnchor {
  const anchor = captureViewportAnchor(doc, previewViewportY(doc, scroll));
  // Absolute fallback belongs to the actual scrolling element, not the host or
  // document (which may remain at zero for a full-height overflow container).
  return { ...anchor, y: scroll.scrollTop };
}

export function restorePreviewAnchor(doc: Document, scroll: HTMLElement, anchor: ViewportAnchor) {
  const top = anchorBlock(doc, anchor)
    ? scroll.scrollTop + resolveViewportAnchor(doc, anchor) - previewViewportY(doc, scroll)
    : anchor.y;
  // Restoration must finish before recording the checkpoint and revealing the
  // frame, regardless of the site's CSS scroll-behavior.
  scroll.scrollTo({ top, behavior: "instant" });
}

export interface CanvasViewportCheckpoint {
  camera: CanvasCamera;
  snappedKey?: string;
  pathname?: string;
  anchor?: ViewportAnchor;
}

/** Owned by one preview surface; deliberately not persisted across projects. */
export class ViewportContinuity {
  history = new Map<string, ViewportAnchor>();
  preview: { capture: () => ViewportAnchor } | null = null;
  canvas: {
    capture: () => CanvasViewportCheckpoint;
    restore: (
      anchor: ViewportAnchor | undefined,
      camera: CanvasCamera | undefined,
      snappedKey?: string,
    ) => void;
  } | null = null;
  pendingPreview: { pathname: string; anchor: ViewportAnchor } | null = null;
  pendingCanvas: { anchor?: ViewportAnchor; camera?: CanvasCamera; snappedKey?: string } | null =
    null;
  checkpoint: {
    pathname: string;
    camera: CanvasCamera;
    snappedKey?: string;
    moved: boolean;
  } | null = null;

  transition(enabled: boolean, pathname: string) {
    if (enabled) {
      const anchor = this.preview?.capture() ?? this.history.get(pathname);
      if (anchor) this.history.set(pathname, anchor);
      const exact = this.checkpoint?.pathname === pathname && !this.checkpoint.moved;
      this.pendingCanvas = {
        anchor: exact ? undefined : anchor,
        camera: this.checkpoint?.camera,
        snappedKey: exact ? this.checkpoint?.snappedKey : undefined,
      };
      return;
    }
    const view = this.canvas?.capture();
    if (!view) return;
    this.checkpoint = { pathname, camera: view.camera, snappedKey: view.snappedKey, moved: false };
    this.pendingPreview = {
      pathname,
      anchor: (view.pathname === pathname ? view.anchor : undefined) ??
        this.history.get(pathname) ?? { y: 0, offset: 0 },
    };
  }

  previewMoved(pathname: string, anchor: ViewportAnchor) {
    this.history.set(pathname, anchor);
    if (this.checkpoint) this.checkpoint.moved = true;
  }

  navigate(pathname: string) {
    if (this.checkpoint) this.checkpoint.moved = true;
    const anchor = this.history.get(pathname) ?? { y: 0, offset: 0 };
    if (this.pendingCanvas) this.pendingCanvas = { anchor, camera: this.pendingCanvas.camera };
    if (this.pendingPreview) this.pendingPreview = { pathname, anchor };
  }

  restoreCanvas() {
    if (!this.canvas || !this.pendingCanvas) return;
    const { anchor, camera, snappedKey } = this.pendingCanvas;
    this.canvas.restore(anchor, camera, snappedKey);
    this.pendingCanvas = null;
  }
}

export const ViewportContinuityContext = React.createContext<ViewportContinuity | null>(null);
