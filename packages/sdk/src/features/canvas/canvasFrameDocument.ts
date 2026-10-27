import { PREVIEW_PAUSED_ATTRIBUTE } from "../../core/lib/previewPaused";
import { EMPTY_PREVIEW_DOCUMENT, isSiteStyle } from "../preview/components/previewStyles";

/** Freezes CSS animations, including ones that start while the frame is paused. */
const PAUSED_ANIMATIONS_STYLE = `html[${PREVIEW_PAUSED_ATTRIBUTE}] *, html[${PREVIEW_PAUSED_ATTRIBUTE}] *::before, html[${PREVIEW_PAUSED_ATTRIBUTE}] *::after { animation-play-state: paused !important; }`;

/**
 * A style of the studio's own for a frame's document, marked so that giving the frame a site
 * document's stylesheets (`restyle`) leaves it.
 */
function studioStyle(doc: Document, css: string) {
  const style = doc.createElement("style");
  style.setAttribute("data-camox-studio", "");
  style.textContent = css;
  return style;
}

/** Set by the camera on elements that hold Canvas frames: see `canvasBlockOverlap`. */
const BLOCK_OVERLAP_ATTRIBUTE = "data-canvas-block-overlap";
const BLOCK = "[data-camox-viewport-block]";
/** Every block after the first, in its container or a later one, covers the end of the one before. */
export const BLOCK_OVERLAP_SELECTOR = `:is(${BLOCK}, :has(${BLOCK})) ~ ${BLOCK}, :is(${BLOCK}, :has(${BLOCK})) ~ * ${BLOCK}`;
const BLOCK_OVERLAP_STYLE = `${BLOCK_OVERLAP_SELECTOR} { margin-top: calc(-1 * var(--camox-block-overlap, 0px)); }`;

/**
 * How far, in CSS pixels, each block in a Canvas frame overlaps the one before it.
 * Where two blocks meet partway through a screen pixel, each covers only part of
 * it, and whatever is under both (the site's background, often unlike either
 * block) shows through as a light seam. Zoomed out, an overlap of at least a
 * device pixel covers it, at the cost of about as much of a block's bottom edge. From
 * 100%, where seams are rare, borders stay exact. Powers of two change a page's
 * height only at a few zooms.
 */
export function canvasBlockOverlap(scale: number, pixelRatio: number) {
  if (scale >= 1) return 0;
  return 2 ** Math.max(0, Math.ceil(Math.log2(1 / (scale * pixelRatio))));
}

export function canvasPageHref(input: { runtimeBasePath: string; pathname: string; href: string }) {
  return new URL(
    `${input.runtimeBasePath.replace(/\/$/, "")}/${input.pathname.replace(/^\//, "")}`,
    input.href,
  ).href;
}

/** Only whole viewport height declarations, not arbitrary values, calc(), or media queries. */
export function logicalViewportValue(value: string) {
  const trimmed = value.trim();
  return /^100(?:s|l|d)?vh$/i.test(trimmed) ? `var(--camox-viewport-height, ${trimmed})` : null;
}

/**
 * The top-level rule count of each sheet once all of it has been adapted. Every
 * measurement adapts, so a sheet is only walked again once rules are inserted
 * into or removed from it, as CSS-in-JS libraries do. Replacing a style
 * element's text creates a new sheet.
 */
const adaptedRuleCounts = new WeakMap<CSSStyleSheet, number>();

/** Mutate this iframe's CSSOM in place so layers, breakpoints and !important keep their order. */
export function adaptCanvasStyleSheets(doc: Document) {
  const visited = new Set<CSSStyleSheet>();
  /** Whether the sheet is settled: false while one of its imports is still loading. */
  function visitSheet(sheet: CSSStyleSheet) {
    if (visited.has(sheet)) return true;
    visited.add(sheet);
    try {
      const rules = sheet.cssRules;
      if (adaptedRuleCounts.get(sheet) === rules.length) return true;
      const settled = visitRules(rules);
      if (settled) adaptedRuleCounts.set(sheet, rules.length);
      return settled;
    } catch {
      // Cross-origin sheets can render but cannot be inspected. Never fetch or copy them.
      return true;
    }
  }
  function visitRules(rules: CSSRuleList) {
    let settled = true;
    for (const rule of Array.from(rules)) {
      if ("style" in rule) {
        const style = (rule as CSSStyleRule).style;
        for (const property of ["height", "min-height", "max-height"]) {
          const replacement = logicalViewportValue(style.getPropertyValue(property));
          if (replacement)
            style.setProperty(property, replacement, style.getPropertyPriority(property));
        }
      }
      if ("cssRules" in rule && !visitRules((rule as CSSGroupingRule).cssRules)) settled = false;
      if ("styleSheet" in rule) {
        const imported = (rule as CSSImportRule).styleSheet;
        if (!imported || !visitSheet(imported)) settled = false;
      }
    }
    return settled;
  }
  for (const sheet of [
    ...Array.from(doc.styleSheets),
    ...Array.from(doc.adoptedStyleSheets ?? []),
  ]) {
    visitSheet(sheet);
  }
}

/** Build before loading so relative styles/images resolve against the page, never /_camox/canvas. */
export function createCanvasDocument(previewDocument: string | undefined, href: string) {
  const doc = new DOMParser().parseFromString(
    previewDocument ?? EMPTY_PREVIEW_DOCUMENT,
    "text/html",
  );
  if (!previewDocument) {
    for (const style of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
      if (isSiteStyle(style)) doc.head.appendChild(style.cloneNode(true));
    }
  }
  doc.querySelectorAll("base").forEach((base) => base.remove());
  const base = doc.createElement("base");
  base.href = href;
  doc.head.insertBefore(base, doc.head.firstChild);
  // Do not execute page bootstraps (which could hydrate a second app or navigate the host).
  // Server-resolved html/body classes and inline style/theme attributes are retained.
  doc.querySelectorAll("script").forEach((script) => script.remove());
  // React owns preview content through the portal. Excluding the server snapshot
  // keeps the iframe document stable when realtime data changes only its body.
  doc.querySelector("[data-camox-preview-root]")?.replaceChildren();
  // Wheel events inside the frame never reach the host window. Until the frame's
  // forwarding listener attaches (first load, or a reload after srcDoc changes),
  // its own root must refuse trackpad swipes as browser Back/Forward gestures.
  doc.documentElement.style.setProperty("overscroll-behavior", "none");
  doc.body.style.setProperty("overscroll-behavior", "none");
  const paused = studioStyle(doc, PAUSED_ANIMATIONS_STYLE);
  doc.head.appendChild(paused);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

/**
 * Give a loaded document what `createCanvasDocument` builds into a Canvas frame's,
 * for as long as it shows in the Canvas: no swipe navigation, CSS animations that
 * pause with the frame, and a page as tall as its content. Returns how to undo
 * all of it, so the document can fill the Preview again.
 */
export function adoptCanvasDocument(
  iframe: HTMLIFrameElement,
  root: HTMLElement,
  viewportHeight: number,
) {
  const doc = root.ownerDocument;
  const paused = studioStyle(doc, PAUSED_ANIMATIONS_STYLE);
  doc.head.appendChild(paused);
  const restored = [doc.documentElement, doc.body].map((element) => ({
    element,
    overscroll: element.style.getPropertyValue("overscroll-behavior"),
    overflow: element.style.getPropertyValue("overflow"),
    overflowPriority: element.style.getPropertyPriority("overflow"),
  }));
  for (const { element } of restored) element.style.setProperty("overscroll-behavior", "none");
  const stopObserving = observeCanvasDocument(iframe, root, viewportHeight);
  return () => {
    stopObserving();
    paused.remove();
    for (const { element, overscroll, overflow, overflowPriority } of restored) {
      element.style.setProperty("overscroll-behavior", overscroll);
      element.style.setProperty("overflow", overflow, overflowPriority);
    }
    // Adapted rules fall back to the real viewport height without the property.
    doc.documentElement.style.removeProperty("--camox-viewport-height");
    iframe.style.removeProperty("height");
  };
}

function isMedia(target: EventTarget | null): target is HTMLMediaElement {
  const name = (target as Element | null)?.localName;
  return name === "video" || name === "audio";
}

/**
 * Pause a frame's document: its animations, transitions and media, including
 * media that starts playing while paused. JavaScript-driven animations are up
 * to blocks, which can watch the document's paused attribute. Returns how to
 * resume exactly what it paused.
 */
export function pauseCanvasDocument(doc: Document) {
  doc.documentElement.setAttribute(PREVIEW_PAUSED_ATTRIBUTE, "");
  const animations: Animation[] = [];
  for (const animation of doc.getAnimations?.() ?? []) {
    // The paused attribute holds CSS animations. Pausing them here would stop
    // their play state following CSS for good.
    if ("animationName" in animation || animation.playState !== "running") continue;
    animation.pause();
    animations.push(animation);
  }
  const media = new Set<HTMLMediaElement>();
  const pauseMedia = (element: HTMLMediaElement) => {
    if (element.paused) return;
    element.pause();
    media.add(element);
  };
  doc.querySelectorAll("video, audio").forEach((element) => {
    if (isMedia(element)) pauseMedia(element);
  });
  const onPlay = (event: Event) => {
    if (isMedia(event.target)) pauseMedia(event.target);
  };
  doc.addEventListener("play", onPlay, true);
  return () => {
    doc.removeEventListener("play", onPlay, true);
    doc.documentElement.removeAttribute(PREVIEW_PAUSED_ATTRIBUTE);
    for (const animation of animations) {
      if (animation.playState === "paused") animation.play();
    }
    for (const element of media) {
      if (element.isConnected && element.paused) void element.play().catch(() => {});
    }
  };
}

export function measureCanvasDocument(
  iframe: HTMLIFrameElement,
  root: HTMLElement,
  baseline: number,
) {
  const doc = root.ownerDocument;
  adaptCanvasStyleSheets(doc);
  iframe.style.height = `${baseline}px`;
  const bodyRect = doc.body.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const height = exactBottom(
    Math.max(rootRect.bottom, bodyRect.bottom),
    doc.body.scrollHeight + bodyRect.top,
    doc.documentElement.scrollHeight,
    root.scrollHeight + rootRect.top,
  );
  iframe.style.height = `${Math.max(baseline, height)}px`;
}

/**
 * The bottom of a document's content, from its boxes' exact, often fractional,
 * bottom. A frame any taller shows a sliver of the document's own background
 * under the last block, which a scaled Canvas can draw as a bright line. Scroll
 * heights are rounded to whole pixels, so they only count where content
 * overflows past those boxes.
 */
function exactBottom(boxesBottom: number, ...scrollBottoms: number[]) {
  const scrollBottom = Math.max(...scrollBottoms);
  return scrollBottom > boxesBottom + 1 ? scrollBottom : boxesBottom;
}

/**
 * Re-measure at a fixed baseline, not at the previous full-page height: document scrollHeight
 * is at least viewport height and therefore cannot shrink an already expanded iframe.
 *
 * While `suspended` (a resting frame, whose content is hidden), the frame keeps its size.
 * Once `resume` is called, it re-measures only if its content or size changed meanwhile.
 */
export function observeCanvasDocument(
  iframe: HTMLIFrameElement,
  root: HTMLElement,
  viewportHeight: number,
  suspended: () => boolean = () => false,
) {
  const doc = root.ownerDocument;
  const baseline = Math.max(1, viewportHeight);
  doc.documentElement.style.setProperty("--camox-viewport-height", `${baseline}px`);
  doc.documentElement.style.setProperty("overflow", "hidden", "important");
  doc.body.style.setProperty("overflow", "hidden", "important");
  const overlapStyle = studioStyle(doc, BLOCK_OVERLAP_STYLE);
  doc.head.appendChild(overlapStyle);
  // The camera sets the overlap on an ancestor of the frame, in the host document.
  const followOverlap = () => {
    const overlap = iframe.closest<HTMLElement>(`[${BLOCK_OVERLAP_ATTRIBUTE}]`);
    const pixels = Number(overlap?.getAttribute(BLOCK_OVERLAP_ATTRIBUTE)) || 0;
    doc.documentElement.style.setProperty("--camox-block-overlap", `${pixels}px`);
  };
  followOverlap();
  const overlapChanges = new MutationObserver(followOverlap);
  overlapChanges.observe(iframe.ownerDocument.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: [BLOCK_OVERLAP_ATTRIBUTE],
  });
  let frame = 0;
  let disposed = false;
  const sizes = new Map<Element, string>();
  const size = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return `${rect.width}:${rect.height}`;
  };
  const resize = new ResizeObserver((entries) => {
    if (entries.some(({ target }) => sizes.get(target) !== size(target))) schedule();
  });
  function measure() {
    frame = 0;
    if (suspended()) return;
    measureCanvasDocument(iframe, root, baseline);
    // Record the *final* geometry to ignore ResizeObserver notifications caused by our sizing.
    const elements = new Set<Element>([doc.body, root, ...root.querySelectorAll("*")]);
    for (const element of sizes.keys()) {
      if (elements.has(element)) continue;
      resize.unobserve(element);
      sizes.delete(element);
    }
    for (const element of elements) {
      if (!sizes.has(element)) resize.observe(element);
      sizes.set(element, size(element));
    }
  }
  function schedule() {
    if (disposed || frame) return;
    frame = requestAnimationFrame(measure);
  }
  // Hiding and showing a resting frame's content resizes it, but it measures
  // as before unless its content changed while hidden.
  let changedWhileSuspended = false;
  function contentChanged() {
    if (suspended()) changedWhileSuspended = true;
    schedule();
  }
  // Animations rewrite inline styles in the content every frame, and blocks
  // toggle classes as they react to scrolling, which a moving camera looks like.
  // Every element of the content is observed, so any size an attribute changes
  // reaches the ResizeObserver: those alone never re-measure, and neither does
  // pausing the frame.
  const isUnsizedChange = (record: MutationRecord) =>
    record.type === "attributes" &&
    (root.contains(record.target) || record.attributeName === PREVIEW_PAUSED_ATTRIBUTE);
  const mutations = new MutationObserver((records) => {
    if (!records.every(isUnsizedChange)) contentChanged();
  });
  mutations.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  mutations.observe(doc.head, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  mutations.observe(doc.documentElement, { attributes: true });
  mutations.observe(doc.body, { attributes: true });
  doc.addEventListener("load", contentChanged, true);
  doc.addEventListener("error", contentChanged, true);
  doc.fonts?.addEventListener("loadingdone", contentChanged);
  void doc.fonts?.ready.then(contentChanged);
  // The selected frame's readiness effect runs after this layout effect.
  // Give camera handoffs real page bounds before they reveal the workspace.
  measure();
  const resume = () => {
    if (disposed) return;
    requestAnimationFrame(() => {
      if (suspended()) return;
      if (changedWhileSuspended || [doc.body, root].some((el) => sizes.get(el) !== size(el)))
        schedule();
      changedWhileSuspended = false;
    });
  };
  const stop = () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    overlapChanges.disconnect();
    overlapStyle.remove();
    doc.documentElement.style.removeProperty("--camox-block-overlap");
    doc.removeEventListener("load", contentChanged, true);
    doc.removeEventListener("error", contentChanged, true);
    doc.fonts?.removeEventListener("loadingdone", contentChanged);
  };
  return Object.assign(stop, { resume });
}
