import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";

import {
  adaptCanvasStyleSheets,
  canvasPageHref,
  createCanvasDocument,
  logicalViewportValue,
  observeCanvasDocument,
} from "./canvasFrameDocument";

void test("canonical href combines runtime mount and page pathname, not the canvas route", () => {
  assert.equal(
    canvasPageHref({
      runtimeBasePath: "/site/",
      pathname: "/about",
      href: "https://example.test/_camox/canvas",
    }),
    "https://example.test/site/about",
  );
  assert.equal(
    canvasPageHref({
      runtimeBasePath: "",
      pathname: "/",
      href: "https://example.test/_camox/canvas",
    }),
    "https://example.test/",
  );
});

void test("viewport compatibility is deliberately limited to exact full-height units", () => {
  for (const unit of ["vh", "svh", "lvh", "dvh"]) {
    assert.equal(logicalViewportValue(`100${unit}`), `var(--camox-viewport-height, 100${unit})`);
  }
  for (const value of ["50vh", "calc(100vh - 2rem)", "100%", "var(--height)", "100vw"]) {
    assert.equal(logicalViewportValue(value), null);
  }
});

void test("CSSOM rewrite retains responsive conditions, cascade, and importance", () => {
  const window = new Window();
  const doc = window.document;
  const style = doc.createElement("style");
  style.textContent =
    ".h-screen { height: 100vh !important; width: 100vh } @media (min-width: 900px) { .responsive { min-height: 100dvh; max-height: 100svh } } .h-screen { height: 300px }";
  doc.head.append(style);
  adaptCanvasStyleSheets(doc as unknown as Document);
  const sheet = style.sheet!;
  const first = sheet.cssRules[0] as unknown as CSSStyleRule;
  assert.equal(first.style.height, "var(--camox-viewport-height, 100vh)");
  assert.equal(first.style.getPropertyPriority("height"), "important");
  assert.equal(first.style.width, "100vh");
  const media = sheet.cssRules[1] as unknown as CSSMediaRule;
  assert.equal(media.conditionText, "(min-width: 900px)");
  const responsive = media.cssRules[0] as CSSStyleRule;
  assert.equal(responsive.style.minHeight, "var(--camox-viewport-height, 100dvh)");
  assert.equal(responsive.style.maxHeight, "var(--camox-viewport-height, 100svh)");
  assert.equal((sheet.cssRules[2] as unknown as CSSStyleRule).style.height, "300px");
  const rewritten = sheet.cssRules.map((rule) => rule.cssText);
  adaptCanvasStyleSheets(doc as unknown as Document);
  assert.deepEqual(
    sheet.cssRules.map((rule) => rule.cssText),
    rewritten,
  );
  void window.happyDOM.close();
});

void test("sheets are walked again only once rules are inserted or an import loads", () => {
  const window = new Window();
  const doc = window.document;
  const style = doc.createElement("style");
  style.textContent = ".a { color: red }";
  doc.head.append(style);
  const sheet = style.sheet!;
  let walks = 0;
  // Iterating the rules, unlike reading their count, is a walk.
  const rules = new Proxy(sheet.cssRules, {
    get: (target, key) => {
      if (key === Symbol.iterator) walks++;
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  Object.defineProperty(sheet, "cssRules", { get: () => rules });
  const pending = { styleSheet: null as unknown, cssText: "@import url(late.css);" };
  const host = { cssRules: [pending] };
  const adapt = () =>
    adaptCanvasStyleSheets({
      styleSheets: [sheet, host],
      adoptedStyleSheets: [],
    } as unknown as Document);

  adapt();
  assert.equal(walks, 1);
  adapt();
  assert.equal(walks, 1, "an unchanged sheet is not walked again");
  sheet.insertRule(".screen { height: 100vh }", sheet.cssRules.length);
  adapt();
  assert.equal(walks, 2);
  assert.equal(
    (sheet.cssRules[1] as unknown as CSSStyleRule).style.height,
    "var(--camox-viewport-height, 100vh)",
  );

  const late = doc.createElement("style");
  late.textContent = ".late { min-height: 100svh }";
  doc.head.append(late);
  pending.styleSheet = late.sheet;
  adapt();
  assert.equal(
    (late.sheet!.cssRules[0] as unknown as CSSStyleRule).style.minHeight,
    "var(--camox-viewport-height, 100svh)",
    "an import still loading leaves its sheet to be walked again",
  );
  void window.happyDOM.close();
});

void test("inaccessible sheets do not prevent later same-origin sheets being adapted", () => {
  const inaccessible = {
    get cssRules() {
      throw new Error("SecurityError");
    },
  };
  assert.doesNotThrow(() =>
    adaptCanvasStyleSheets({
      styleSheets: [inaccessible],
      adoptedStyleSheets: [],
    } as unknown as Document),
  );
});

void test("document retains site theme/styles, resolves relative URLs, and removes execution", (t) => {
  const window = new Window();
  const original = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: window.DOMParser });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "DOMParser", original);
    else Reflect.deleteProperty(globalThis, "DOMParser");
  });
  const result = createCanvasDocument(
    '<html class="dark"><head><base href="https://wrong.test/"><style>.site {color:red}</style><script>location.href="/"</script></head><body class="site"><div data-camox-preview-root></div></body></html>',
    "https://example.test/site/about",
  );
  const doc = new window.DOMParser().parseFromString(result, "text/html");
  assert.equal(doc.documentElement.className, "dark");
  assert.equal(doc.body.className, "site");
  assert.equal(doc.querySelector("base")?.href, "https://example.test/site/about");
  assert.equal(doc.querySelectorAll("base").length, 1);
  assert.equal(doc.querySelectorAll("script").length, 0);
  assert.ok(doc.querySelector("style"));
  assert.equal(doc.documentElement.inert, false);
  assert.equal(doc.body.inert, false);
  assert.equal(doc.documentElement.style.getPropertyValue("overscroll-behavior"), "none");
  assert.equal(doc.body.style.getPropertyValue("overscroll-behavior"), "none");
  void window.happyDOM.close();
});

void test("document shell ignores server-rendered preview content", (t) => {
  const window = new Window();
  const original = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: window.DOMParser });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "DOMParser", original);
    else Reflect.deleteProperty(globalThis, "DOMParser");
  });

  const documentWith = (content: string) =>
    createCanvasDocument(
      `<html><head><style>.site {color:red}</style></head><body><div data-camox-preview-root>${content}</div></body></html>`,
      "https://example.test/site/about",
    );

  assert.equal(documentWith("<p>Before</p>"), documentWith("<p>After</p>"));
  void window.happyDOM.close();
});

void test("sizing grows and shrinks from a fixed baseline, batches changes, and cleans up", (t) => {
  const window = new Window();
  const doc = window.document;
  const root = doc.createElement("div");
  doc.body.appendChild(root);
  const iframe = { style: { height: "800px" } };
  let contentHeight = 1800;
  let queued: FrameRequestCallback | undefined;
  let resizeCallback: ResizeObserverCallback | undefined;
  let mutationCallback: MutationCallback | undefined;
  let disconnected = 0;
  const setGlobal = (key: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  };
  setGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queued = callback;
    return 1;
  });
  setGlobal("cancelAnimationFrame", () => {
    queued = undefined;
  });
  setGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {
        disconnected++;
      }
    },
  );
  setGlobal(
    "MutationObserver",
    class {
      constructor(callback: MutationCallback) {
        mutationCallback = callback;
      }
      observe() {}
      disconnect() {
        disconnected++;
      }
    },
  );
  Object.defineProperty(doc.documentElement, "scrollHeight", {
    get: () => Math.max(Number.parseFloat(iframe.style.height), contentHeight),
  });
  Object.defineProperty(root, "scrollHeight", { get: () => contentHeight });
  const cleanup = observeCanvasDocument(
    iframe as HTMLIFrameElement,
    root as unknown as HTMLElement,
    800,
  );
  const flush = () => {
    const callback = queued;
    queued = undefined;
    callback?.(0);
  };
  const mutate = (type: MutationRecordType, target: unknown, attributeName: string | null = null) =>
    mutationCallback!(
      [{ type, target, attributeName } as unknown as MutationRecord],
      {} as MutationObserver,
    );
  const contentChanged = () => mutate("childList", root);
  flush();
  assert.equal(iframe.style.height, "1800px");
  contentHeight = 950;
  contentChanged();
  const first = queued;
  contentChanged();
  assert.equal(queued, first);
  flush();
  assert.equal(iframe.style.height, "950px");
  resizeCallback!([{ target: root } as unknown as ResizeObserverEntry], {} as ResizeObserver);
  assert.equal(queued, undefined, "our final geometry does not trigger another measurement");
  contentHeight = 100;
  contentChanged();
  flush();
  assert.equal(iframe.style.height, "800px");
  const animated = doc.createElement("div");
  root.appendChild(animated);
  mutate("attributes", animated, "style");
  mutate("attributes", root, "style");
  assert.equal(queued, undefined, "animated inline styles in the content leave sizing to resizes");
  mutate("attributes", animated, "class");
  assert.notEqual(queued, undefined, "other content attributes re-measure");
  flush();
  mutate("attributes", doc.body, "style");
  assert.notEqual(queued, undefined, "the document's own inline styles re-measure");
  cleanup();
  assert.equal(disconnected, 2);
  assert.equal(queued, undefined);
  void window.happyDOM.close();
});
