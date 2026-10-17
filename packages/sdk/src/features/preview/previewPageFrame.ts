import * as React from "react";

import type { CanvasFrameMode } from "../canvas/canvasFrameMode";
import type { CanvasWorkspaceContext } from "../canvas/canvasZoom";

/**
 * Where the Canvas shows the selected Page: its place in the row, and how its
 * frame runs there.
 */
export interface PreviewPageSlot {
  /** The Canvas viewport the frame is clipped to and forwards camera input to. */
  viewport: HTMLElement;
  /** The Page's place in the Canvas row, in world space. */
  left: number;
  top: number;
  /** The device the Canvas previews. */
  width: number;
  viewportHeight: number;
  mode: CanvasFrameMode;
  workspace: React.ContextType<typeof CanvasWorkspaceContext>;
  /** An interaction inside the frame, which activates the Page in the Canvas. */
  onInteract: () => void;
}

type Snapshot = {
  slot: PreviewPageSlot | null;
  /** The frame's measured height in its slot. */
  height: number;
  /** Where the slot portals the Canvas overlays drawn over the frame. */
  overlays: HTMLElement | null;
  iframe: HTMLIFrameElement | null;
};

/**
 * The Preview's one page frame, which the Canvas borrows for the selected Page.
 * Edit Mode only moves and restyles it, so the page's state, such as an open
 * modal or typed input, carries over in both directions. Selecting another
 * Page renders that Page in it instead.
 */
export class PreviewPageFrame {
  private snapshot: Snapshot = {
    slot: null,
    height: 0,
    overlays: null,
    iframe: null,
  };
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private update(patch: Partial<Snapshot>) {
    const next = { ...this.snapshot, ...patch };
    const changed = (Object.keys(patch) as (keyof Snapshot)[]).some(
      (key) => next[key] !== this.snapshot[key],
    );
    if (!changed) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  setSlot(slot: PreviewPageSlot | null) {
    this.update({ slot });
  }

  setHeight(height: number) {
    this.update({ height });
  }

  setOverlays(overlays: HTMLElement | null) {
    this.update({ overlays });
  }

  setIframe(iframe: HTMLIFrameElement | null) {
    this.update({ iframe });
  }
}

/**
 * The frame, whether the Canvas shows, so the frame can take its slot, and the
 * pathname of the page it shows, which the Canvas gives that slot.
 */
export const PreviewPageFrameContext = React.createContext<{
  frame: PreviewPageFrame;
  revealed: boolean;
  pathname?: string;
} | null>(null);

const emptySnapshot: Snapshot = { slot: null, height: 0, overlays: null, iframe: null };
const noSubscription = () => () => {};
const getEmptySnapshot = () => emptySnapshot;

export function usePreviewPageFrame() {
  const context = React.use(PreviewPageFrameContext);
  const frame = context?.frame ?? null;
  const snapshot = React.useSyncExternalStore(
    frame?.subscribe ?? noSubscription,
    frame?.getSnapshot ?? getEmptySnapshot,
    frame?.getSnapshot ?? getEmptySnapshot,
  );
  const revealed = !!context?.revealed;
  return { frame, ...snapshot, revealed, inCanvas: revealed && snapshot.slot !== null };
}

/**
 * The frame's layer over the Canvas row, from outside the Canvas. The Canvas
 * chrome drawn over Pages, such as page headers and Shelf Markers, stays above it.
 */
export const PREVIEW_PAGE_Z_INDEX = 1;
export const CANVAS_CHROME_Z_INDEX = PREVIEW_PAGE_Z_INDEX + 1;

/** Marks the Canvas slot whose Page the Preview page frame shows. */
export const PREVIEW_PAGE_SLOT_ATTRIBUTE = "data-canvas-preview-page";
const PREVIEW_PAGE_IFRAME_ATTRIBUTE = "data-preview-page-frame";

export const previewPageIframeProps = { [PREVIEW_PAGE_IFRAME_ATTRIBUTE]: "" };

/** The frame showing a Canvas Page: its own, or the Preview page frame placed over it. */
export function canvasPageIframe(page: HTMLElement): HTMLIFrameElement | null {
  if (!page.hasAttribute(PREVIEW_PAGE_SLOT_ATTRIBUTE)) return page.querySelector("iframe");
  return page.ownerDocument.querySelector<HTMLIFrameElement>(
    `iframe[${PREVIEW_PAGE_IFRAME_ATTRIBUTE}]`,
  );
}
