import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

import type { EditingFrameElement, ReleaseEditingFrame } from "./editingFrame";
import { EditingFrameClaimant, editingFrameProbe, fakeEditingFrame } from "./editingFrame.fixtures";
import type { OverlayMessage } from "./overlayMessages";
import type { EditingOwner } from "./previewStore";

/** A frame with its own document, recording what the Studio sends it. */
function fakeFrame(dom: Window) {
  const document = dom.document.implementation.createHTMLDocument() as unknown as Document;
  return { ...fakeEditingFrame(document), document };
}

async function setup() {
  const dom = new Window();
  const globals = { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { previewStore } = await import("./previewStore");

  /** The Preview and Canvas frames, which claim when the test says so. */
  const claims = new Map<string, () => ReleaseEditingFrame>();
  type Claimant = {
    name: string;
    frame: EditingFrameElement | null;
    owner: EditingOwner | null;
  };
  /** A sidebar, which only reads and sends through the module. */
  const sidebar = editingFrameProbe();

  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const render = (claimants: Claimant[]) =>
    React.act(async () =>
      root.render(
        <>
          {claimants.map(({ name, frame, owner }) => (
            <EditingFrameClaimant
              key={name}
              frame={frame}
              owner={owner}
              claimed={false}
              onClaim={(claim) => claims.set(name, claim)}
            />
          ))}
          <sidebar.EditingFrameProbe />
        </>,
      ),
    );
  const claim = async (name: string) => {
    let release: ReleaseEditingFrame | undefined;
    await React.act(async () => {
      release = claims.get(name)!();
    });
    return async () => React.act(async () => release!());
  };

  return {
    dom,
    previewStore,
    render,
    claim,
    sidebar: () => sidebar,
    async close() {
      await React.act(async () => root.unmount());
      previewStore.send({ type: "reset" });
      await dom.happyDOM.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

const page = (pageId: string): EditingOwner => ({ kind: "page", pageId });
const hover = (blockId: string): OverlayMessage => ({ type: "CAMOX_HOVER_BLOCK", blockId });

void test("what a sidebar sends reaches only the claimed frame, and nothing before a claim", async () => {
  const studio = await setup();
  try {
    const a = fakeFrame(studio.dom);
    const b = fakeFrame(studio.dom);
    await studio.render([
      { name: "a", frame: a.frame, owner: page("1") },
      { name: "b", frame: b.frame, owner: page("2") },
    ]);
    studio.sidebar().send(hover("early"));
    assert.ok(studio.sidebar().document === null);

    await studio.claim("b");
    studio.sidebar().send(hover("k"));
    assert.deepEqual(b.sent, [hover("k")]);
    assert.deepEqual(a.sent, []);
    assert.ok(studio.sidebar().document === b.document);
    assert.deepEqual(studio.previewStore.getSnapshot().context.editingContext, {
      ...page("2"),
      selection: null,
    });
  } finally {
    await studio.close();
  }
});

void test("a frame releases only its own claim, and releasing it clears the selection", async () => {
  const studio = await setup();
  try {
    const a = fakeFrame(studio.dom);
    const b = fakeFrame(studio.dom);
    await studio.render([
      { name: "a", frame: a.frame, owner: page("1") },
      { name: "b", frame: b.frame, owner: page("2") },
    ]);
    const releaseA = await studio.claim("a");
    const releaseB = await studio.claim("b");
    studio.previewStore.send({ type: "setFocusedBlock", ...page("2"), blockId: "42" });

    await releaseA();
    studio.sidebar().send(hover("k"));
    assert.deepEqual(b.sent, [hover("k")], "a stale release leaves the other frame active");
    assert.deepEqual(studio.previewStore.getSnapshot().context.editingContext?.selection, {
      type: "block",
      blockId: "42",
    });

    await releaseB();
    studio.sidebar().send(hover("after"));
    assert.deepEqual(b.sent, [hover("k")], "once released, nothing is sent");
    assert.ok(studio.sidebar().document === null);
    assert.equal(studio.previewStore.getSnapshot().context.editingContext?.selection, null);
    await releaseB();
  } finally {
    await studio.close();
  }
});

void test("the Preview and the Canvas slot share one frame, each releasing only its own claim", async () => {
  const studio = await setup();
  try {
    const shared = fakeFrame(studio.dom);
    const props = [
      { name: "preview", frame: shared.frame, owner: page("1") },
      { name: "slot", frame: shared.frame, owner: page("1") },
    ];
    await studio.render(props);
    await studio.claim("preview");
    await studio.claim("slot");
    studio.previewStore.send({ type: "setFocusedBlock", ...page("1"), blockId: "42" });

    // Leaving Edit Mode: the Preview claims its frame back again before the slot unmounts.
    await studio.claim("preview");
    assert.deepEqual(
      studio.previewStore.getSnapshot().context.editingContext?.selection,
      { type: "block", blockId: "42" },
      "claiming again for the same owner keeps the selection",
    );
    await studio.render(props.slice(0, 1));
    studio.sidebar().send(hover("k"));
    assert.deepEqual(shared.sent, [hover("k")], "the slot's release left the Preview's claim");

    await studio.render([{ ...props[0], owner: page("2") }]);
    await studio.claim("preview");
    assert.deepEqual(studio.previewStore.getSnapshot().context.editingContext, {
      ...page("2"),
      selection: null,
    });

    await studio.render([]);
    assert.ok(studio.sidebar().document === null, "an unmounted frame releases its claim");
  } finally {
    await studio.close();
  }
});

void test("a claim made before the frame loads follows the frame once it does", async () => {
  const studio = await setup();
  try {
    const loaded = fakeFrame(studio.dom);
    await studio.render([{ name: "preview", frame: null, owner: page("1") }]);
    await studio.claim("preview");
    studio.sidebar().send(hover("early"));

    await studio.render([{ name: "preview", frame: loaded.frame, owner: page("1") }]);
    studio.sidebar().send(hover("k"));
    assert.deepEqual(loaded.sent, [hover("k")]);
    assert.ok(studio.sidebar().document === loaded.document);
  } finally {
    await studio.close();
  }
});
