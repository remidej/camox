import { observeOverlayHighlights } from "../preview/overlayHighlights";
import { readBlockInsertion, type CanvasBlockInsertion } from "./canvasInsertionSeams";

export type OverlayRect = { x: number; y: number; width: number; height: number };

export type CanvasOverlayTarget = {
  element: Element;
  rects: OverlayRect[];
  bounds: OverlayRect;
  hovered: boolean;
  focused: boolean;
  synced: boolean;
  inline: boolean;
  insertion?: CanvasBlockInsertion;
};

const targetSelector =
  "[data-camox-field-id], [data-camox-block-id], [data-camox-repeater-item-id]";

// These attributes describe editor state, never site content or layout.
const stateAttributes = new Set([
  "data-camox-hovered",
  "data-camox-focused",
  "data-camox-hover-group",
  "data-camox-highlight-hovered",
  "data-camox-highlight-focused",
  "data-camox-overlay-mode",
]);

function rectOf({ x, y, width, height }: DOMRect): OverlayRect {
  return { x, y, width, height };
}

function stateOf(element: Element) {
  return {
    hovered: element.hasAttribute("data-camox-highlight-hovered"),
    focused: element.hasAttribute("data-camox-highlight-focused"),
    synced: ["synced", "reference"].includes(
      element.closest("[data-camox-overlay-mode]")?.getAttribute("data-camox-overlay-mode") ?? "",
    ),
  };
}

function measure(element: Element): CanvasOverlayTarget {
  const stringField =
    element.hasAttribute("data-camox-field-id") && !element.hasAttribute("data-camox-field-type");
  const inline =
    stringField ||
    (element.localName === "svg" && element.getAttribute("data-camox-field-type") === "icon");
  const bounds = rectOf(element.getBoundingClientRect());
  const rects = stringField ? Array.from(element.getClientRects(), rectOf) : [bounds];
  return {
    element,
    bounds,
    rects: rects.filter((rect) => rect.width > 0 && rect.height > 0),
    inline,
    insertion: readBlockInsertion(element),
    ...stateOf(element),
  };
}

/**
 * Coordinates stay in the non-scrolling iframe's viewport. The canvas camera
 * transforms the iframe and its overlay layer together, without remeasurement.
 * This owns highlight arbitration as well as its mutation observer.
 */
export function observeCanvasOverlays(
  document: Document,
  onChange: (targets: CanvasOverlayTarget[]) => void,
): () => void {
  let visibleTargets = new Set<Element>();
  const highlights = observeOverlayHighlights(document, (element) => visibleTargets.has(element));
  let targets: CanvasOverlayTarget[] = [];
  let stopped = false;
  let frame: number | undefined;
  const window = document.defaultView;
  const measureAll = () => {
    frame = undefined;
    if (stopped) return;
    targets = Array.from(document.querySelectorAll(targetSelector), measure);
    // Detached/duplicate content can retain selection metadata while hidden.
    // Cache visibility here, never during hover/focus arbitration.
    visibleTargets = new Set(
      targets
        .filter(({ element }) =>
          element.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
        )
        .map(({ element }) => element),
    );
    highlights.refresh();
    targets = targets.map((target) => ({ ...target, ...stateOf(target.element) }));
    onChange(targets);
  };
  const scheduleMeasurement = () => {
    if (stopped || frame !== undefined) return;
    if (!window) {
      measureAll();
      return;
    }
    // Run after the frame's content-driven sizing pass, not against its temporary
    // viewport height. Interaction-only changes below still never read layout.
    frame = window.requestAnimationFrame(measureAll);
  };
  const Observer = document.defaultView?.MutationObserver;
  const observer = Observer
    ? new Observer((mutations) => {
        if (stopped) return;
        // Any content mutation can move siblings, so refresh the complete cache
        // once per batch. State-only batches must never read layout.
        if (
          mutations.some(
            (mutation) =>
              mutation.type !== "attributes" || !stateAttributes.has(mutation.attributeName ?? ""),
          )
        ) {
          scheduleMeasurement();
          return;
        }
        let changed = false;
        const next = targets.map((target) => {
          const state = stateOf(target.element);
          if (
            state.hovered === target.hovered &&
            state.focused === target.focused &&
            state.synced === target.synced
          ) {
            return target;
          }
          changed = true;
          return { ...target, ...state };
        });
        if (!changed) return;
        targets = next;
        onChange(targets);
      })
    : undefined;
  observer?.observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  // Images and fonts settling are content updates too, even when they do not
  // mutate the DOM. These are discrete invalidations, never a layout watch.
  document.addEventListener("load", scheduleMeasurement, true);
  document.addEventListener("error", scheduleMeasurement, true);
  document.fonts?.addEventListener("loadingdone", scheduleMeasurement);
  void document.fonts?.ready.then(scheduleMeasurement);
  scheduleMeasurement();
  return () => {
    stopped = true;
    if (frame !== undefined) window?.cancelAnimationFrame(frame);
    observer?.disconnect();
    document.removeEventListener("load", scheduleMeasurement, true);
    document.removeEventListener("error", scheduleMeasurement, true);
    document.fonts?.removeEventListener("loadingdone", scheduleMeasurement);
    highlights.dispose();
    targets = [];
    visibleTargets.clear();
  };
}
