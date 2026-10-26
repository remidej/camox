import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { toast } from "@camox/ui/toaster";
import {
  Window,
  type HTMLElement as HappyHTMLElement,
  type HTMLInputElement as HappyInputElement,
} from "happy-dom";
import * as React from "react";

import type { PreviewPreparationContext } from "../previewPreparation";
import { ViewportContinuityContext } from "../viewportContinuity";

type Signals = NonNullable<React.ContextType<typeof PreviewPreparationContext>>;
const preparationUrl = new URL("../previewPreparation.ts", import.meta.url).href;
const continuityUrl = new URL("../viewportContinuity.ts", import.meta.url).href;
let imports = 0;
let failImport = false;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.endsWith("/CanvasPreview.tsx") &&
      specifier === "../../canvas/CamoxCanvas"
    ) {
      imports++;
      if (failImport) throw new Error("Canvas module unavailable");
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(`
          import { PreviewPreparationContext } from ${JSON.stringify(preparationUrl)};
          import { ViewportContinuityContext } from ${JSON.stringify(continuityUrl)};
          await globalThis.canvasModuleGate;
          export function CamoxCanvas() {
            const preparation = React.useContext(PreviewPreparationContext);
            const continuity = React.useContext(ViewportContinuityContext);
            if (globalThis.canvasRenderFails) throw new Error("Canvas could not render");
            React.useLayoutEffect(() => {
              globalThis.canvasSignals.push(preparation);
            }, [preparation]);
            React.useLayoutEffect(() => {
              const binding = {
                capture: () => {
                  globalThis.viewportEvents.push(["canvas-capture", !!document.querySelector("[data-canvas]")]);
                  return {camera: {x: -123, y: -456, scale: .7}};
                },
                restore: (anchor, camera) => {
                  globalThis.viewportEvents.push(["restore", anchor, camera,
                    document.querySelector("[data-canvas-preparation]").style.opacity]);
                },
              };
              continuity.canvas = binding;
              return () => { if (continuity.canvas === binding) continuity.canvas = null; };
            }, [continuity]);
            return React.createElement("div", {"data-canvas": true}, "Prepared canvas");
          }
        `)}`,
      };
    }
    return nextResolve(specifier, context);
  },
});

void test("Canvas handoff never remounts the original preview through loading, reveal, cancellation, failure and retry", async () => {
  const window = new Window();
  let loadModule!: () => void;
  const signals: Signals[] = [];
  const viewportEvents: unknown[][] = [];
  const globals = {
    React,
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
    canvasModuleGate: new Promise<void>((resolve) => (loadModule = resolve)),
    canvasSignals: signals,
    canvasRenderFails: false,
    viewportEvents,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  const { CanvasPreview, prefetchCanvas } = await import("./CanvasPreview");
  function PreviewProbe() {
    const continuity = React.useContext(ViewportContinuityContext)!;
    React.useLayoutEffect(() => {
      const binding = {
        capture: () => {
          viewportEvents.push([
            "preview-capture",
            !!window.document.querySelector("[data-site-input]"),
          ]);
          return { blockId: "42", offset: 200, y: 800 };
        },
      };
      continuity.preview = binding;
      return () => {
        if (continuity.preview === binding) continuity.preview = null;
      };
    }, [continuity]);
    return <input data-site-input defaultValue="Visitor input" />;
  }
  const root = createRoot(window.document.body as unknown as HTMLElement, {
    onCaughtError() {},
  });
  const preview = () => window.document.querySelector<HappyInputElement>("[data-site-input]");
  const canvas = () => window.document.querySelector("[data-canvas]");
  const preparation = () =>
    window.document.querySelector<HappyHTMLElement>("[data-canvas-preparation]");
  const placeholder = () => window.document.querySelector("[data-sidebar-placeholder]");
  const loading = () => window.document.querySelector("[data-canvas-loading]");
  const spinner = () => loading()?.querySelector('[role="status"]') ?? null;
  /** Loading shows in the Canvas's place, never as a toast. */
  const assertLoading = (message = "a spinner shows the Canvas loading") => {
    assert.ok(spinner(), message);
    assert.equal(toast.getToasts().length, 0, "loading shows no toast");
  };
  const assertFailureToast = () => {
    const toasts = toast.getToasts();
    assert.equal(toasts.length, 1);
    const notification = toasts[0];
    assert.ok("type" in notification);
    assert.equal(notification.type, "error");
    assert.equal(notification.title, "Could not load studio.");
    assert.equal(window.document.querySelector('[role="alert"]'), null, "no inline error panel");
    return notification;
  };
  const retryToast = async () => {
    const { action } = assertFailureToast();
    assert.ok(action && typeof action === "object" && "onClick" in action);
    assert.equal(action.label, "Retry");
    await React.act(async () => action.onClick({} as React.MouseEvent<HTMLButtonElement>));
  };
  const render = async (enabled: boolean, pathname = "/") => {
    await React.act(async () => {
      root.render(
        <CanvasPreview
          enabled={enabled}
          pathname={pathname}
          runtimeBasePath="/mounted"
          placeholder={<aside data-sidebar-placeholder />}
        >
          <PreviewProbe />
        </CanvasPreview>,
      );
    });
  };
  try {
    await render(false);
    const original = preview()!;
    original.value = "Keep this value";
    assert.equal(imports, 0, "read-only preview never imports Canvas");
    assert.equal(placeholder(), null, "the read-only preview shows no sidebar placeholder");
    assert.equal(loading(), null, "the read-only preview shows the page");
    assert.equal(toast.getToasts().length, 0);

    // A failed import, prefetched or shown, is retried by the next load.
    failImport = true;
    prefetchCanvas();
    await React.act(async () => {});
    assert.equal(imports, 1, "prefetching imports Canvas before it shows");
    await render(true);
    assert.equal(imports, 2, "a failed prefetch leaves the next show to import again");
    assert.equal(preview(), original, "a failed import retains the site");
    assertFailureToast();
    failImport = false;
    await render(false);
    assert.equal(toast.getToasts().length, 0);
    viewportEvents.length = 0;

    await render(true);
    assert.equal(imports, 3, "showing again after a failed import imports again");
    assert.deepEqual(viewportEvents[0], ["preview-capture", true], "capture precedes DOM changes");
    assertLoading();
    assert.equal(preview(), original, "the original DOM survives module suspension");
    assert.equal(preview()?.value, "Keep this value");
    assert.equal(canvas(), null);
    assert.ok(placeholder(), "the Canvas sidebar's placeholder shows while the Canvas prepares");
    assert.equal(
      placeholder()?.nextElementSibling,
      preview()?.closest("[data-read-only-preview]"),
      "the placeholder stands over the preview, where the Canvas sidebar shows",
    );
    assert.equal(
      loading()?.parentElement,
      preview()?.closest("[data-read-only-preview]"),
      "a loading screen covers the page, where the Canvas will show",
    );
    assert.equal(preparation()?.style.opacity, "0");
    assert.ok(preparation()?.hasAttribute("inert"));
    assert.equal(preparation()?.getAttribute("aria-hidden"), "true");
    assert.doesNotMatch(window.document.body.textContent, /Loading preview/);

    await React.act(async () => {
      loadModule();
      await globals.canvasModuleGate;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.ok(canvas());
    assert.equal(preview(), original, "module loading alone does not reveal Canvas");
    assertLoading();
    const firstSignals = signals.at(-1)!;
    const firstCanvas = canvas();
    await React.act(async () => firstSignals.ready());
    assert.deepEqual(
      viewportEvents[1],
      ["restore", { blockId: "42", offset: 200, y: 800 }, undefined, "0"],
      "position is staged before revealing the canvas",
    );
    assert.equal(preview(), original, "revealing keeps the preview: the Canvas borrows its frame");
    assert.equal(preview()?.value, "Keep this value");
    assert.equal(canvas(), firstCanvas, "revealing does not remount the prepared workspace");
    assert.equal(preparation()?.style.opacity, "1");
    assert.equal(preparation()?.hasAttribute("inert"), false);
    assert.equal(placeholder(), null, "the revealed Canvas's own sidebar replaces the placeholder");
    assert.equal(loading(), null, "the revealed Canvas ends the loading screen");
    assert.equal(toast.getToasts().length, 0, "readiness shows no notification");

    const beforeSubmode = viewportEvents.length;
    await render(true);
    assert.equal(
      viewportEvents.length,
      beforeSubmode,
      "edit rerenders do not hand off the viewport",
    );

    await render(false);
    assert.deepEqual(
      viewportEvents[2],
      ["canvas-capture", true],
      "capture precedes canvas removal",
    );
    assert.equal(placeholder(), null, "leaving editing shows no placeholder");
    assert.equal(canvas(), firstCanvas, "leaving editing keeps the ready Canvas, hidden");
    const outgoing = preview();
    const importsBeforeWarm = imports;
    await render(true);
    assert.equal(canvas(), firstCanvas, "a warm Canvas shows again without remounting");
    assert.equal(imports, importsBeforeWarm, "a warm Canvas never loads again");
    assert.ok(loading(), "the page stays covered until the warm Canvas shows");
    assert.equal(spinner(), null, "a warm Canvas shows no spinner");
    const cancelled = signals.at(-1)!;
    const beforeCancel = viewportEvents.length;
    await render(false);
    assert.equal(
      viewportEvents.length,
      beforeCancel,
      "cancellation does not capture an unrevealed camera",
    );
    assert.equal(toast.getToasts().length, 0, "cancelling shows no notification");
    await render(true);
    const current = signals.at(-1)!;
    await React.act(async () => {
      cancelled.ready();
      firstSignals.fail(new Error("Stale failure"));
    });
    assert.equal(preview(), outgoing);
    assert.equal(
      preparation()?.style.opacity,
      "0",
      "cancelled callbacks cannot reveal a new attempt",
    );
    assert.equal(window.document.querySelector('[role="alert"]'), null);
    assert.equal(toast.getToasts().length, 0);

    await React.act(async () => current.fail(new Error("Page data unavailable")));
    assert.equal(preview(), outgoing);
    assert.equal(canvas(), null);
    assert.equal(placeholder(), null, "a failed Canvas shows no placeholder");
    assert.equal(loading(), null, "a failed Canvas shows the page again");
    assertFailureToast();
    await retryToast();
    assertLoading("a retry loads a new Canvas, with a spinner");
    assert.equal(preview(), outgoing, "retry retains the same site DOM");
    const retry = signals.at(-1)!;
    await React.act(async () => current.ready());
    assert.equal(preparation()?.style.opacity, "0", "failed attempt cannot win over its retry");
    await React.act(async () => retry.ready());
    assert.equal(preview(), original);

    await render(false);
    const beforeNavigation = preview();
    await render(true);
    const previousPage = signals.at(-1)!;
    await render(true, "/other");
    const nextPage = signals.at(-1)!;
    await React.act(async () => previousPage.ready());
    assert.equal(preview(), beforeNavigation);
    assert.equal(preparation()?.style.opacity, "0", "old URL cannot reveal the next URL's editor");
    await React.act(async () => nextPage.ready());
    const workspace = canvas();
    await render(true, "/third");
    assert.equal(canvas(), workspace, "visible workspace survives URL changes");

    await render(false);
    const beforeError = preview();
    Object.assign(globalThis, { canvasRenderFails: true });
    await render(true);
    assert.equal(preview(), beforeError, "render/import errors retain the site");
    assertFailureToast();
    Object.assign(globalThis, { canvasRenderFails: false });
    await retryToast();
    await React.act(async () => signals.at(-1)!.ready());
    assert.equal(preview(), original);
    assert.ok(canvas());

    // Loaded code shows a cold Canvas without suspending: start over without the warm one.
    await React.act(async () => root.render(null));
    const importsBeforeCold = imports;
    let renderedInSamePass = false;
    await React.act(async () => {
      flushSync(() =>
        root.render(
          <CanvasPreview enabled pathname="/" runtimeBasePath="/mounted">
            <PreviewProbe />
          </CanvasPreview>,
        ),
      );
      renderedInSamePass = !!canvas();
    });
    assert.ok(renderedInSamePass, "loaded Canvas code renders in the same pass");
    assert.equal(imports, importsBeforeCold, "loaded Canvas code never imports again");
    assertLoading("a cold Canvas still shows the spinner until it is ready");
    await React.act(async () => signals.at(-1)!.ready());
    assert.equal(toast.getToasts().length, 0);
    assert.equal(
      toast
        .getHistory()
        .some((notification) => "type" in notification && notification.type === "success"),
      false,
      "successful startup never creates a success notification",
    );

    // A fatal render after readiness still offers a retry.
    Object.assign(globalThis, { canvasRenderFails: true });
    await render(true);
    assertFailureToast();
    Object.assign(globalThis, { canvasRenderFails: false });
    await render(false);
    assert.equal(toast.getToasts().length, 0, "leaving editing also clears failure toasts");

    await React.act(async () => root.render(null));
    await React.act(async () => {
      root.render(
        <React.StrictMode>
          <CanvasPreview enabled pathname="/" runtimeBasePath="/mounted">
            <input data-site-input />
          </CanvasPreview>
        </React.StrictMode>,
      );
    });
    const lastSignals = signals.at(-1)!;
    await React.act(async () => root.render(null));
    await React.act(async () => lastSignals.fail(new Error("Late failure after unmount")));
    assert.equal(toast.getToasts().length, 0, "late failures cannot raise a notification");
  } finally {
    failImport = false;
    await React.act(async () => root.unmount());
    assert.equal(toast.getToasts().length, 0, "unmount leaves no studio toast behind");
    await window.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
