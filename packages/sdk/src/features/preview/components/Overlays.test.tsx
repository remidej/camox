import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "@camox/ui/toaster") source = "export const toast = () => {}";
    if (context.parentURL?.endsWith("/Overlays.tsx")) {
      if (specifier === "../CamoxPreview")
        source =
          "export const usePreviewedPage = () => React.useContext(globalThis.TestPageContext)";
      if (specifier === "@/lib/normalized-data")
        source = "export const usePageBlocks = page => ({pageBlocks: page.blocks})";
    }
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

void test("only the active page resolves add requests, including layout boundaries and regular blocks", async () => {
  const dom = new Window();
  const TestPageContext = React.createContext({
    page: { id: 1 },
    blocks: [{ position: "a0" }, { position: "a1" }],
  });
  const globals = {
    React,
    window: dom,
    document: dom.document,
    TestPageContext,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { Overlays } = await import("./Overlays");
  const { previewStore } = await import("../previewStore");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const frames = [document.createElement("iframe"), document.createElement("iframe")];
  previewStore.send({ type: "enterEditMode" });
  previewStore.send({ type: "activatePage", pageId: 2 });
  previewStore.send({ type: "setIframeElement", element: frames[1] });
  try {
    await React.act(async () => {
      root.render(
        <>
          {frames.map((frame, index) => (
            <TestPageContext
              key={index}
              value={{ page: { id: index + 1 }, blocks: [{ position: "a0" }, { position: "a1" }] }}
            >
              <Overlays
                owner={{ kind: "page", pageId: index + 1 }}
                iframeElement={frame}
                canAddBlocks
              />
            </TestPageContext>
          ))}
        </>,
      );
    });
    let opened = 0;
    const subscription = previewStore.subscribe((snapshot) => {
      if (snapshot.context.addBlockDialog) opened++;
    });
    for (const [insertPosition, blockPosition, override, expected] of [
      ["before", "a0", undefined, ""],
      ["before", "a1", undefined, "a0"],
      ["after", "a0", undefined, "a0"],
      ["after", "layout-before", "", ""],
      ["before", "layout-after", null, null],
    ] as const) {
      previewStore.send({ type: "closeAddBlockDialog" });
      const before = opened;
      await React.act(async () => {
        dom.dispatchEvent(
          new dom.MessageEvent("message", {
            data: {
              type: "CAMOX_ADD_BLOCK_REQUEST",
              insertPosition,
              blockPosition,
              ...(override !== undefined && { afterPosition: override }),
            },
          }),
        );
      });
      assert.equal(opened, before + 1, "inactive canvas listeners must not open the picker");
      assert.equal(previewStore.getSnapshot().context.addBlockDialog?.afterPosition, expected);
    }
    previewStore.send({ type: "closeAddBlockDialog" });
    previewStore.send({ type: "exitEditMode" });
    dom.dispatchEvent(
      new dom.MessageEvent("message", {
        data: { type: "CAMOX_ADD_BLOCK_REQUEST", insertPosition: "after", blockPosition: "a0" },
      }),
    );
    assert.equal(previewStore.getSnapshot().context.addBlockDialog, null);
    subscription.unsubscribe();
  } finally {
    await React.act(async () => root.unmount());
    previewStore.send({ type: "activatePage", pageId: null });
    previewStore.send({ type: "setIframeElement", element: null });
    previewStore.send({ type: "closeAddBlockDialog" });
    previewStore.send({ type: "exitEditMode" });
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

void test("selecting a record text field focuses it in the selected placement", async () => {
  const dom = new Window();
  const globals = { React, window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { Overlays } = await import("./Overlays");
  const { previewStore } = await import("../previewStore");
  const root = createRoot(document.createElement("div"));
  const messages: unknown[] = [];
  const iframe = {
    contentWindow: { postMessage: (message: unknown) => messages.push(message) },
  } as unknown as HTMLIFrameElement;
  const owner = { kind: "page", pageId: 1 } as const;
  previewStore.send({ type: "enterEditMode" });
  previewStore.send({ type: "activatePage", pageId: 1 });
  try {
    await React.act(async () => root.render(<Overlays owner={owner} iframeElement={iframe} />));
    await React.act(async () =>
      previewStore.send({
        type: "selectRecordField",
        ...owner,
        blockId: 2,
        fieldName: "customer",
        recordId: "acme",
        recordFieldName: "quote",
        recordFieldType: "String",
      }),
    );
    assert.deepEqual(messages.at(-1), { type: "CAMOX_FOCUS_FIELD", fieldId: "2__customer__quote" });
  } finally {
    await React.act(async () => root.unmount());
    previewStore.send({ type: "activatePage", pageId: null });
    previewStore.send({ type: "exitEditMode" });
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
