import { EMPTY_PREVIEW_DOCUMENT, isSiteStyle } from "../preview/components/previewStyles";

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

/** Mutate this iframe's CSSOM in place so layers, breakpoints and !important keep their order. */
export function adaptCanvasStyleSheets(doc: Document) {
  const visited = new Set<CSSStyleSheet>();
  function visitSheet(sheet: CSSStyleSheet) {
    if (visited.has(sheet)) return;
    visited.add(sheet);
    try {
      visitRules(sheet.cssRules);
    } catch {
      // Cross-origin sheets can render but cannot be inspected. Never fetch or copy them.
    }
  }
  function visitRules(rules: CSSRuleList) {
    for (const rule of Array.from(rules)) {
      if ("style" in rule) {
        const style = (rule as CSSStyleRule).style;
        for (const property of ["height", "min-height", "max-height"]) {
          const replacement = logicalViewportValue(style.getPropertyValue(property));
          if (replacement)
            style.setProperty(property, replacement, style.getPropertyPriority(property));
        }
      }
      if ("cssRules" in rule) visitRules((rule as CSSGroupingRule).cssRules);
      if ("styleSheet" in rule && (rule as CSSImportRule).styleSheet) {
        visitSheet((rule as CSSImportRule).styleSheet!);
      }
    }
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
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

/**
 * Re-measure at a fixed baseline, not at the previous full-page height: document scrollHeight
 * is at least viewport height and therefore cannot shrink an already expanded iframe.
 */
export function observeCanvasDocument(
  iframe: HTMLIFrameElement,
  root: HTMLElement,
  viewportHeight: number,
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
    adaptCanvasStyleSheets(doc);
    iframe.style.height = `${baseline}px`;
    const bodyRect = doc.body.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const height = Math.ceil(
      Math.max(
        baseline,
        doc.body.scrollHeight + bodyRect.top,
        doc.documentElement.scrollHeight,
        rootRect.bottom,
        root.scrollHeight + rootRect.top,
      ),
    );
    iframe.style.height = `${height}px`;
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
  const mutations = new MutationObserver(schedule);
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
  schedule();
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
