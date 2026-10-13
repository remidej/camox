import * as React from "react";

import { PREVIEW_PAUSED_ATTRIBUTE } from "./lib/previewPaused";

/** The browsing context that owns a rendered element. */
export interface ElementContext {
  document: Document;
  window: Window & typeof globalThis;
}

/**
 * Resolve DOM APIs from an element rather than the component's JavaScript realm.
 * In Camox preview, elements belong to an iframe but component globals belong
 * to the editor. Call this after mounting (for example, inside an effect).
 *
 * Returns null for a missing element or a document without a window. Never
 * falls back to globals. This does not convert objects into the target realm.
 */
export function getElementContext(element: Element | null | undefined): ElementContext | null {
  if (!element) return null;

  const document = element.ownerDocument;
  const window = document.defaultView;
  if (!window) return null;

  return { document, window };
}

/**
 * Whether Camox has paused the preview rendering an element, such as a Canvas
 * frame nobody is looking at. Camox already pauses CSS animations, transitions
 * and media there; stop JavaScript-driven animation (WebGL, canvas, requestAnimationFrame
 * loops) while this is true. Always false outside Camox preview.
 *
 * The element must render together with the component calling this.
 */
export function usePreviewPaused(ref: React.RefObject<Element | null>): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const root = ref.current?.ownerDocument.documentElement;
      const Observer = root?.ownerDocument.defaultView?.MutationObserver;
      if (!root || !Observer) return () => {};
      const observer = new Observer(onChange);
      observer.observe(root, { attributes: true, attributeFilter: [PREVIEW_PAUSED_ATTRIBUTE] });
      return () => observer.disconnect();
    },
    [ref],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => !!ref.current?.ownerDocument.documentElement.hasAttribute(PREVIEW_PAUSED_ATTRIBUTE),
    () => false,
  );
}
