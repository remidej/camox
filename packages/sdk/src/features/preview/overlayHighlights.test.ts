import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";

import { observeOverlayHighlights } from "./overlayHighlights";

void test("one deepest highlight per state, including remote candidates and removal", async () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `
    <div id="block" data-camox-block-id="1" data-camox-hovered data-camox-focused>
      <div id="item" data-camox-repeater-item-id="2" data-camox-hovered>
        <span id="field" data-camox-field-id="title" data-camox-hovered data-camox-focused></span>
      </div>
    </div>`;
  const stop = observeOverlayHighlights(document as unknown as Document);
  const highlighted = (state: string) =>
    Array.from(document.querySelectorAll(`[data-camox-highlight-${state}]`), (el) => el.id);
  try {
    assert.deepEqual(highlighted("hovered"), ["field"]);
    assert.deepEqual(highlighted("focused"), ["field"]);

    // Leaving the field restores its hovered parent, without changing selection.
    document.getElementById("field")!.removeAttribute("data-camox-hovered");
    await window.happyDOM.whenAsyncComplete();
    assert.deepEqual(highlighted("hovered"), ["item"]);
    assert.deepEqual(highlighted("focused"), ["field"]);

    // Sidebar hover can activate several separate items at once.
    document
      .getElementById("block")!
      .insertAdjacentHTML(
        "beforeend",
        '<div id="remote" data-camox-repeater-item-id="3" data-camox-hovered></div>',
      );
    await window.happyDOM.whenAsyncComplete();
    assert.deepEqual(highlighted("hovered"), ["item"]);

    document.getElementById("item")!.remove();
    await window.happyDOM.whenAsyncComplete();
    assert.deepEqual(highlighted("hovered"), ["remote"]);
    assert.deepEqual(highlighted("focused"), ["block"]);

    stop();
    assert.deepEqual(highlighted("hovered"), []);
    assert.deepEqual(highlighted("focused"), []);
  } finally {
    stop();
    await window.happyDOM.close();
  }
});

void test("detached borders cannot outrank fields inside their represented container", async () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `
    <div data-camox-block-id="1" data-camox-focused>
      <nav>
        <div id="border" data-camox-detached data-camox-block-id="1" data-camox-focused></div>
        <svg id="icon" data-camox-field-id="icon" data-camox-field-type="icon" data-camox-focused></svg>
      </nav>
    </div>`;
  const stop = observeOverlayHighlights(document as unknown as Document);
  try {
    assert.equal(document.querySelector("[data-camox-highlight-focused]")?.id, "icon");
    document.getElementById("icon")!.removeAttribute("data-camox-focused");
    await window.happyDOM.whenAsyncComplete();
    assert.equal(document.querySelector("[data-camox-highlight-focused]")?.id, "border");
  } finally {
    stop();
    await window.happyDOM.close();
  }
});
