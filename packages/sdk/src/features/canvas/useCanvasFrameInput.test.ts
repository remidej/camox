import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";

void test("wheel input over overlays outside the Canvas viewport moves the camera", async () => {
  const dom = new Window();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "WheelEvent");
  Object.assign(globalThis, { WheelEvent: dom.WheelEvent });
  try {
    const { forwardCanvasWheel } = await import("./useCanvasFrameInput");
    const viewport = dom.document.createElement("div");
    const clip = dom.document.createElement("div");
    const overlay = dom.document.createElement("button");
    clip.append(overlay);
    dom.document.body.append(viewport, clip);
    const received: WheelEvent[] = [];
    viewport.addEventListener("wheel", (event) => received.push(event as unknown as WheelEvent));

    const stop = forwardCanvasWheel(
      clip as unknown as HTMLElement,
      viewport as unknown as HTMLElement,
    );
    const swipe = new dom.WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaX: 3,
      deltaY: 40,
    });
    overlay.dispatchEvent(swipe);

    assert.equal(swipe.defaultPrevented, true, "the page under the overlay never scrolls");
    assert.equal(received.length, 1);
    const [forwarded] = received;
    // happy-dom's WheelEvent has no pointer coordinates or modifier keys.
    assert.deepEqual([forwarded.deltaX, forwarded.deltaY], [3, 40]);

    stop();
    overlay.dispatchEvent(new dom.WheelEvent("wheel", { bubbles: true, deltaY: 10 }));
    assert.equal(received.length, 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, "WheelEvent", previous);
    else delete (globalThis as { WheelEvent?: unknown }).WheelEvent;
    await dom.happyDOM.close();
  }
});
