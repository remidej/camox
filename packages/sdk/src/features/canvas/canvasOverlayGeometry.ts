import { resolveOverlayHighlights } from "../preview/overlayHighlights";
import {
  repeatableItemElements,
  subscribeRepeatableItems,
  type RepeatableItemTarget,
} from "../preview/repeatableItemTargets";
import { readBlockInsertion, type CanvasBlockInsertion } from "./canvasInsertionSeams";

export type OverlayRect = { x: number; y: number; width: number; height: number };

export type CanvasOverlayTarget = {
  /** Repeatable items have no element of their own; this is their first one. */
  element: Element;
  item?: { blockId: number; itemId: number };
  rects: OverlayRect[];
  bounds: OverlayRect;
  visible: boolean;
  hovered: boolean;
  focused: boolean;
  synced: boolean;
  inline: boolean;
  insertion?: CanvasBlockInsertion;
};

/** A target's geometry plus what highlight arbitration needs to rank it. */
type Entry = {
  target: CanvasOverlayTarget;
  depth: number;
  item?: RepeatableItemTarget;
};

const targetSelector = "[data-camox-field-id], [data-camox-block-id]";

// These attributes describe editor state, never site content or layout.
const stateAttributes = new Set([
  "data-camox-hovered",
  "data-camox-focused",
  "data-camox-overlay-mode",
]);

function rectOf({ x, y, width, height }: DOMRect): OverlayRect {
  return { x, y, width, height };
}

function hasArea(rect: OverlayRect) {
  return rect.width > 0 && rect.height > 0;
}

function unionOf(rects: OverlayRect[]): OverlayRect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function depthOf(element: Element): number {
  let depth = 0;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) depth++;
  return depth;
}

function isVisible(element: Element) {
  return element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
}

function inheritsSyncedMode(element: Element) {
  return ["synced", "reference"].includes(
    element.closest("[data-camox-overlay-mode]")?.getAttribute("data-camox-overlay-mode") ?? "",
  );
}

function rawStateOf({ target, item }: Entry) {
  if (item) {
    return {
      hovered: item.hovered,
      focused: item.focused,
      hoverGroup: item.hoverGroup,
      synced: item.synced || inheritsSyncedMode(target.element),
    };
  }
  return {
    hovered: target.element.hasAttribute("data-camox-hovered"),
    focused: target.element.hasAttribute("data-camox-focused"),
    hoverGroup: null,
    synced: inheritsSyncedMode(target.element),
  };
}

function measureElement(element: Element): Entry {
  const stringField =
    element.hasAttribute("data-camox-field-id") && !element.hasAttribute("data-camox-field-type");
  const inline =
    stringField ||
    (element.localName === "svg" && element.getAttribute("data-camox-field-type") === "icon");
  const bounds = rectOf(element.getBoundingClientRect());
  const rects = stringField ? Array.from(element.getClientRects(), rectOf) : [bounds];
  return {
    depth: depthOf(element),
    target: {
      element,
      bounds,
      rects: rects.filter(hasArea),
      visible: isVisible(element),
      inline,
      insertion: readBlockInsertion(element),
      hovered: false,
      focused: false,
      synced: false,
    },
  };
}

function measureItem(item: RepeatableItemTarget, elements: Element[]): Entry {
  // Includes text and inline line boxes that the elements' own boxes would miss.
  const rects = Array.from(item.fragment.getClientRects(), rectOf).filter(hasArea);
  return {
    item,
    // Above its elements' parent and below fields rendered as those elements.
    // Nested items sharing the same elements outrank the item that contains them.
    depth: Math.min(...elements.map(depthOf)) - 1 / (item.nesting + 2),
    target: {
      element: elements[0]!,
      item: { blockId: item.blockId, itemId: item.itemId },
      bounds: rects.length > 0 ? unionOf(rects) : rectOf(elements[0]!.getBoundingClientRect()),
      rects,
      visible: elements.some(isVisible),
      inline: false,
      hovered: false,
      focused: false,
      synced: false,
    },
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
  let entries: Entry[] = [];
  let targets: CanvasOverlayTarget[] = [];
  let stopped = false;
  let frame: number | undefined;
  const window = document.defaultView;
  // Interaction-only updates: cached geometry and visibility, never layout reads.
  const publish = (force: boolean) => {
    const states = entries.map(rawStateOf);
    // Detached/duplicate content can retain selection metadata while hidden.
    const candidates = entries.flatMap((entry, index) =>
      entry.target.visible ? [{ index, depth: entry.depth, ...states[index]! }] : [],
    );
    const winners = resolveOverlayHighlights(candidates);
    const hovered = new Set(Array.from(winners.hovered, ({ index }) => index));
    const focused = new Set(Array.from(winners.focused, ({ index }) => index));
    let changed = force;
    const next = entries.map((entry, index) => {
      const state = {
        hovered: hovered.has(index),
        focused: focused.has(index),
        synced: states[index]!.synced,
      };
      const previous = force ? entry.target : targets[index]!;
      if (
        !force &&
        state.hovered === previous.hovered &&
        state.focused === previous.focused &&
        state.synced === previous.synced
      ) {
        return previous;
      }
      changed = true;
      return { ...entry.target, ...state };
    });
    if (!changed) return;
    targets = next;
    onChange(targets);
  };
  const measureAll = () => {
    frame = undefined;
    if (stopped) return;
    entries = Array.from(document.querySelectorAll(targetSelector), measureElement);
    for (const [item, elements] of repeatableItemElements(document)) {
      if (elements.length > 0) entries.push(measureItem(item, elements));
    }
    publish(true);
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
        publish(false);
      })
    : undefined;
  observer?.observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  const unsubscribeItems = subscribeRepeatableItems(document, (kind) => {
    if (stopped) return;
    if (kind === "content") scheduleMeasurement();
    else publish(false);
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
    unsubscribeItems();
    document.removeEventListener("load", scheduleMeasurement, true);
    document.removeEventListener("error", scheduleMeasurement, true);
    document.fonts?.removeEventListener("loadingdone", scheduleMeasurement);
    entries = [];
    targets = [];
  };
}
