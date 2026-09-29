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

type Signals = NonNullable<React.ContextType<typeof PreviewPreparationContext>>;
const preparationUrl = new URL("../previewPreparation.ts", import.meta.url).href;
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
          await globalThis.canvasModuleGate;
          export function CamoxCanvas() {
            const preparation = React.useContext(PreviewPreparationContext);
            if (globalThis.canvasRenderFails) throw new Error("Canvas could not render");
            React.useLayoutEffect(() => {
              globalThis.canvasSignals.push(preparation);
            }, [preparation]);
            return React.createElement("div", {"data-canvas": true}, "Prepared canvas");
          }
        `)}`,
      };
    }
    return nextResolve(specifier, context);
  },
});

void test("Canvas handoff retains the original preview through loading, cancellation, failure and retry", async () => {
  const window = new Window();
  let loadModule!: () => void;
  const signals: Signals[] = [];
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
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { CanvasPreview } = await import("./CanvasPreview");
  const root = createRoot(window.document.body as unknown as HTMLElement, {
    onCaughtError() {},
  });
  const preview = () => window.document.querySelector<HappyInputElement>("[data-site-input]");
  const canvas = () => window.document.querySelector("[data-canvas]");
  const preparation = () =>
    window.document.querySelector<HappyHTMLElement>("[data-canvas-preparation]");
  const assertToast = (type: "loading" | "error") => {
    const toasts = toast.getToasts();
    assert.equal(toasts.length, 1);
    const notification = toasts[0];
    assert.ok("type" in notification);
    assert.equal(notification.type, type);
    assert.equal(
      notification.title,
      type === "loading" ? "Loading Studio..." : "Could not load studio.",
    );
    assert.equal(window.document.querySelector('[role="alert"]'), null, "no inline error panel");
    return notification;
  };
  const retryToast = async () => {
    const { action } = assertToast("error");
    assert.ok(action && typeof action === "object" && "onClick" in action);
    assert.equal(action.label, "Retry");
    await React.act(async () => action.onClick({} as React.MouseEvent<HTMLButtonElement>));
  };
  const render = async (enabled: boolean, pathname = "/") => {
    await React.act(async () => {
      root.render(
        <CanvasPreview enabled={enabled} pathname={pathname} runtimeBasePath="/mounted">
          <input data-site-input defaultValue="Visitor input" />
        </CanvasPreview>,
      );
    });
  };
  try {
    await render(false);
    const original = preview()!;
    original.value = "Keep this value";
    assert.equal(imports, 0, "read-only preview never imports Canvas");
    assert.equal(toast.getToasts().length, 0);

    await render(true);
    assertToast("loading");
    assert.equal(preview(), original, "the original DOM survives module suspension");
    assert.equal(preview()?.value, "Keep this value");
    assert.equal(canvas(), null);
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
    assertToast("loading");
    const firstSignals = signals.at(-1)!;
    const firstCanvas = canvas();
    await React.act(async () => firstSignals.ready());
    assert.equal(preview(), null);
    assert.equal(canvas(), firstCanvas, "revealing does not remount the prepared workspace");
    assert.equal(preparation()?.style.opacity, "1");
    assert.equal(preparation()?.hasAttribute("inert"), false);
    assert.equal(toast.getToasts().length, 0, "readiness silently dismisses the promise toast");

    await render(false);
    const outgoing = preview();
    await render(true);
    const cancelled = signals.at(-1)!;
    await render(false);
    assert.equal(toast.getToasts().length, 0, "cancelling dismisses the loading toast");
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
    assertToast("loading");

    await React.act(async () => current.fail(new Error("Page data unavailable")));
    assert.equal(preview(), outgoing);
    assert.equal(canvas(), null);
    assertToast("error");
    await retryToast();
    assertToast("loading");
    assert.equal(preview(), outgoing, "retry retains the same site DOM");
    const retry = signals.at(-1)!;
    await React.act(async () => current.ready());
    assert.equal(preparation()?.style.opacity, "0", "failed attempt cannot win over its retry");
    await React.act(async () => retry.ready());
    assert.equal(preview(), null);

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
    assertToast("error");
    Object.assign(globalThis, { canvasRenderFails: false });
    await retryToast();
    await React.act(async () => signals.at(-1)!.ready());
    assert.equal(preview(), null);
    assert.ok(canvas());

    await render(false);
    const beforeImportFailure = preview();
    failImport = true;
    await render(true);
    assert.equal(preview(), beforeImportFailure);
    assertToast("error");
    failImport = false;
    await retryToast();
    assert.equal(preview(), beforeImportFailure);
    await React.act(async () => signals.at(-1)!.ready());
    assert.equal(preview(), null, "retry uses a fresh lazy component after a rejected import");
    assert.equal(toast.getToasts().length, 0);
    assert.equal(
      toast
        .getHistory()
        .some((notification) => "type" in notification && notification.type === "success"),
      false,
      "successful startup never creates a success notification",
    );

    // A fatal render after readiness still offers a retry, even though the
    // original preparation promise has already resolved.
    Object.assign(globalThis, { canvasRenderFails: true });
    await render(true);
    assertToast("error");
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
    assertToast("loading");
    const lastSignals = signals.at(-1)!;
    await React.act(async () => root.render(null));
    assert.equal(toast.getToasts().length, 0, "unmount cancels a pending promise toast");
    await React.act(async () => lastSignals.fail(new Error("Late failure after unmount")));
    assert.equal(toast.getToasts().length, 0, "late failures cannot resurrect a cancelled toast");
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
