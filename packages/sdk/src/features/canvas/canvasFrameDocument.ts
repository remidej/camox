import { PREVIEW_PAUSED_ATTRIBUTE } from "../../core/lib/previewPaused";
import { EMPTY_PREVIEW_DOCUMENT, isSiteStyle } from "../preview/components/previewStyles";

/** Freezes CSS animations, including ones that start while the frame is paused. */
const PAUSED_ANIMATIONS_STYLE = `html[${PREVIEW_PAUSED_ATTRIBUTE}] *, html[${PREVIEW_PAUSED_ATTRIBUTE}] *::before, html[${PREVIEW_PAUSED_ATTRIBUTE}] *::after { animation-play-state: paused !important; }`;

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
  const paused = doc.createElement("style");
  paused.textContent = PAUSED_ANIMATIONS_STYLE;
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
  const paused = doc.createElement("style");
  paused.textContent = PAUSED_ANIMATIONS_STYLE;
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

/**
 * The stylesheets of a site document's head, which shape how any content
 * renders in it. Pages of a site share them, while their titles, metadata and
 * preloads differ.
 */
export function canvasDocumentStyles(previewDocument: string | undefined) {
  if (!previewDocument) return "";
  const doc = new DOMParser().parseFromString(previewDocument, "text/html");
  return Array.from(doc.head.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((style) => style.outerHTML)
    .join("\n");
}

/**
 * How a frame sizes itself: a Page fills at least the viewport height, like a
 * browser window, while a block is only as tall as its content.
 */
export type CanvasDocumentFit = "page" | "content";

export function measureCanvasDocument(
  iframe: HTMLIFrameElement,
  root: HTMLElement,
  baseline: number,
  fit: CanvasDocumentFit = "page",
) {
  const doc = root.ownerDocument;
  adaptCanvasStyleSheets(doc);
  iframe.style.height = `${baseline}px`;
  const bodyRect = doc.body.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  if (fit === "content") {
    // The document's own heights are at least the frame's, so only the root's count.
    const height = Math.max(rootRect.bottom, root.scrollHeight + rootRect.top);
    iframe.style.height = `${Math.max(1, Math.ceil(height))}px`;
    return;
  }
  iframe.style.height = `${Math.ceil(
    Math.max(
      baseline,
      doc.body.scrollHeight + bodyRect.top,
      doc.documentElement.scrollHeight,
      rootRect.bottom,
      root.scrollHeight + rootRect.top,
    ),
  )}px`;
}

/**
 * Re-measure at a fixed baseline, not at the previous full-page height: document scrollHeight
 * is at least viewport height and therefore cannot shrink an already expanded iframe.
 */
export function observeCanvasDocument(
  iframe: HTMLIFrameElement,
  root: HTMLElement,
  viewportHeight: number,
  fit: CanvasDocumentFit = "page",
) {
  const doc = root.ownerDocument;
  const baseline = Math.max(1, viewportHeight);
  doc.documentElement.style.setProperty("--camox-viewport-height", `${baseline}px`);
  doc.documentElement.style.setProperty("overflow", "hidden", "important");
  doc.body.style.setProperty("overflow", "hidden", "important");
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
    measureCanvasDocument(iframe, root, baseline, fit);
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
  // Animations rewrite inline styles in the content every frame. Any size they
  // change reaches the ResizeObserver, so those alone never re-measure, and
  // neither does pausing the frame.
  const isUnsizedChange = (record: MutationRecord) =>
    record.type === "attributes" &&
    ((record.attributeName === "style" && root.contains(record.target)) ||
      record.attributeName === PREVIEW_PAUSED_ATTRIBUTE);
  const mutations = new MutationObserver((records) => {
    if (!records.every(isUnsizedChange)) schedule();
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
  doc.addEventListener("load", schedule, true);
  doc.addEventListener("error", schedule, true);
  doc.fonts?.addEventListener("loadingdone", schedule);
  void doc.fonts?.ready.then(schedule);
  // The selected frame's readiness effect runs after this layout effect.
  // Give camera handoffs real page bounds before they reveal the workspace.
  measure();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    doc.removeEventListener("load", schedule, true);
    doc.removeEventListener("error", schedule, true);
    doc.fonts?.removeEventListener("loadingdone", schedule);
  };
}
