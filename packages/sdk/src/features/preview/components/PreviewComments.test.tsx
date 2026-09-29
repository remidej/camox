import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@camox/ui/toaster") {
      return {
        url: `data:text/javascript,${encodeURIComponent("export const toast = () => {}")}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

void test("frame-local comment cursors survive active-page changes and frame disposal", async () => {
  const host = new Window();
  const first = new Window();
  const second = new Window();
  const globals = {
    React,
    window: host,
    document: host.document,
    HTMLElement: host.HTMLElement,
    Element: host.Element,
    Node: host.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { PreviewComments } = await import("./PreviewComments");
  const { previewStore } = await import("../previewStore");
  const { previewCommentsStore } = await import("../previewCommentsStore");
  const firstFrame = { contentDocument: first.document } as unknown as HTMLIFrameElement;
  const secondFrame = { contentDocument: second.document } as unknown as HTMLIFrameElement;
  const root = createRoot(host.document.body as unknown as HTMLElement);
  const render = (showFirst: boolean) => (
    <React.StrictMode>
      {showFirst && <PreviewComments key="first" iframeElement={firstFrame} />}
      <PreviewComments key="second" iframeElement={secondFrame} />
      <PreviewComments key="not-ready" iframeElement={null} />
    </React.StrictMode>
  );
  try {
    previewStore.send({ type: "enterEditMode" });
    previewStore.send({ type: "setCommentMode", enabled: true });
    previewStore.send({ type: "setIframeElement", element: firstFrame });
    previewCommentsStore.send({ type: "startComment", pageId: 2, target: { kind: "page" } });
    previewCommentsStore.send({ type: "setMessage", message: "Keep this feedback" });
    const draft = previewCommentsStore.getSnapshot().context.draft;

    await React.act(async () => root.render(render(true)));
    assert.equal(previewStore.getSnapshot().context.mode, "commenting-draft");
    assert.equal(first.document.head.querySelectorAll("style").length, 1);
    assert.equal(second.document.head.querySelectorAll("style").length, 1);
    assert.equal(host.document.body.textContent, "", "no per-frame thread or composer UI");

    await React.act(async () =>
      previewStore.send({ type: "setIframeElement", element: secondFrame }),
    );
    assert.equal(first.document.head.querySelectorAll("style").length, 1);
    assert.equal(second.document.head.querySelectorAll("style").length, 1);
    await React.act(async () => root.render(render(false)));
    assert.equal(first.document.head.querySelector("style"), null);
    assert.equal(second.document.head.querySelectorAll("style").length, 1);
    assert.equal(previewStore.getSnapshot().context.mode, "commenting-draft");
    assert.equal(previewCommentsStore.getSnapshot().context.draft, draft);

    await React.act(async () => previewStore.send({ type: "setCommentMode", enabled: false }));
    assert.equal(second.document.head.querySelector("style"), null);
  } finally {
    await React.act(async () => root.unmount());
    previewStore.send({ type: "setIframeElement", element: null });
    previewStore.send({ type: "exitEditMode" });
    previewCommentsStore.send({ type: "clearSelection" });
    await Promise.all([host.happyDOM.close(), first.happyDOM.close(), second.happyDOM.close()]);
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
