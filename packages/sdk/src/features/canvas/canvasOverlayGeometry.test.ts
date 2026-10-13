import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import type { FragmentInstance } from "react";

import { registerRepeatableItem, type RepeatableItemState } from "../preview/repeatableItemTargets";
import { observeCanvasOverlays, type CanvasOverlayTarget } from "./canvasOverlayGeometry";

function fixture() {
  const window = new Window();
  const document = window.document;
  let targets: CanvasOverlayTarget[] = [];
  let updates = 0;
  const start = () =>
    observeCanvasOverlays(document as unknown as Document, (next) => {
      targets = next;
      updates++;
    });
  return {
    window,
    document,
    start,
    get targets() {
      return targets;
    },
    get updates() {
      return updates;
    },
    flush: () => window.happyDOM.waitUntilComplete(),
  };
}

void test("measures line fragments, boxes, SVG icons and empty targets in iframe coordinates", async () => {
  const page = fixture();
  page.document.body.innerHTML = `
    <div data-camox-block-id="block" data-camox-overlay-mode="synced">
      <span data-camox-field-id="title">Title</span>
      <svg data-camox-field-id="icon" data-camox-field-type="icon"></svg>
      <img data-camox-field-id="empty" data-camox-field-type="Image" />
    </div>`;
  const elements = Array.from(
    page.document.querySelectorAll("[data-camox-block-id], [data-camox-field-id]"),
  );
  for (const element of elements) {
    element.getBoundingClientRect = () => new page.window.DOMRect(10, 20, 80, 40);
  }
  const title = elements[1]!;
  title.getClientRects = () =>
    [
      new page.window.DOMRect(10, 20, 80, 20),
      new page.window.DOMRect(10, 40, 40, 20),
      new page.window.DOMRect(10, 60, 0, 20),
    ] as unknown as ReturnType<typeof title.getClientRects>;
  elements[3]!.getBoundingClientRect = () => new page.window.DOMRect(90, 60, 0, 0);
  const stop = page.start();
  await page.flush();
  assert.equal(page.targets.length, 4);
  assert.deepEqual(page.targets[1]!.rects, [
    { x: 10, y: 20, width: 80, height: 20 },
    { x: 10, y: 40, width: 40, height: 20 },
  ]);
  assert.deepEqual(
    page.targets.map((target) => target.inline),
    [false, true, true, false],
  );
  assert.ok(page.targets.every((target) => target.synced));
  assert.deepEqual(page.targets[3]!.rects, []);
  assert.deepEqual(page.targets[3]!.bounds, { x: 90, y: 60, width: 0, height: 0 });
  stop();
  await page.window.happyDOM.close();
});

void test("reference fields are shared purple targets without recoloring their local block", async () => {
  const page = fixture();
  page.document.body.innerHTML = `
    <div data-camox-block-id="testimonial">
      <span data-camox-field-id="quote">Local quote</span>
      <span data-camox-overlay-mode="reference" data-camox-field-id="company">Shared company</span>
    </div>`;
  const stop = page.start();
  await page.flush();
  assert.deepEqual(
    page.targets.map((target) => target.synced),
    [false, false, true],
  );
  stop();
  await page.window.happyDOM.close();
});

void test("hover/focus and synced state reuse geometry; content batches remeasure all targets", async () => {
  const page = fixture();
  page.document.body.innerHTML =
    '<div data-camox-block-id="block"><span data-camox-field-id="title">Title</span></div>';
  const block = page.document.querySelector("div")!;
  const field = page.document.querySelector("span")!;
  let boundsReads = 0;
  let fragmentReads = 0;
  for (const element of [block, field]) {
    element.getBoundingClientRect = () => {
      boundsReads++;
      return new page.window.DOMRect(1, 2, 30, 40);
    };
  }
  field.getClientRects = () => {
    fragmentReads++;
    return [new page.window.DOMRect(1, 2, 30, 40)] as unknown as ReturnType<
      typeof field.getClientRects
    >;
  };
  const stop = page.start();
  await page.flush();
  const initialBounds = page.targets[1]!.bounds;
  const initialRects = page.targets[1]!.rects;
  assert.deepEqual([boundsReads, fragmentReads], [2, 1]);
  block.setAttribute("data-camox-hovered", "");
  block.setAttribute("data-camox-focused", "");
  field.setAttribute("data-camox-hovered", "");
  field.setAttribute("data-camox-focused", "");
  await page.flush();
  assert.equal(page.targets[0]!.hovered, false);
  assert.equal(page.targets[0]!.focused, false);
  assert.equal(page.targets[1]!.hovered, true);
  assert.equal(page.targets[1]!.focused, true);
  field.removeAttribute("data-camox-hovered");
  field.removeAttribute("data-camox-focused");
  block.setAttribute("data-camox-overlay-mode", "synced");
  await page.flush();
  assert.equal(page.targets[0]!.hovered, true);
  assert.equal(page.targets[0]!.focused, true);
  assert.equal(page.targets[1]!.hovered, false);
  assert.equal(page.targets[1]!.focused, false);
  assert.equal(page.targets[1]!.synced, true);
  assert.equal(page.targets[1]!.bounds, initialBounds);
  assert.equal(page.targets[1]!.rects, initialRects);
  assert.deepEqual([boundsReads, fragmentReads], [2, 1]);
  page.document.documentElement.setAttribute("data-camox-paused", "");
  await page.flush();
  assert.deepEqual([boundsReads, fragmentReads], [2, 1], "pausing the frame does not re-measure");

  field.firstChild!.textContent = "Changed";
  block.setAttribute("class", "layout");
  field.setAttribute("style", "font-size: 20px");
  await page.flush();
  assert.deepEqual([boundsReads, fragmentReads], [4, 2]);
  field.setAttribute("src", "/new-content");
  await page.flush();
  assert.deepEqual([boundsReads, fragmentReads], [6, 3]);
  field.remove();
  await page.flush();
  assert.equal(page.targets.length, 1);
  assert.deepEqual([boundsReads, fragmentReads], [7, 3]);
  stop();
  await page.window.happyDOM.close();
});

void test("scroll/resize do not measure and cleanup cancels queued mutations and highlight state", async () => {
  const page = fixture();
  page.document.body.innerHTML = '<div data-camox-block-id="block" data-camox-hovered></div>';
  const block = page.document.querySelector("div")!;
  let reads = 0;
  block.getBoundingClientRect = () => {
    reads++;
    return new page.window.DOMRect(1, 2, 30, 40);
  };
  const stop = page.start();
  await page.flush();
  assert.equal(page.targets[0]!.hovered, true);
  page.window.dispatchEvent(new page.window.Event("resize"));
  page.document.dispatchEvent(new page.window.Event("scroll"));
  await page.flush();
  assert.equal(reads, 1);
  const updates = page.updates;
  block.setAttribute("class", "queued");
  stop();
  block.setAttribute("data-camox-focused", "");
  block.textContent = "After cleanup";
  await page.flush();
  assert.equal(reads, 1);
  assert.equal(page.updates, updates);
  assert.equal(block.hasAttribute("data-camox-highlight-hovered"), false);
  assert.equal(block.hasAttribute("data-camox-highlight-focused"), false);
  await page.window.happyDOM.close();
});

void test("content measurements run after the frame sizing pass and cancel on disposal", async () => {
  const page = fixture();
  page.document.body.innerHTML = '<div data-camox-block-id="block"></div>';
  const block = page.document.querySelector("div")!;
  let height = 100;
  let reads = 0;
  block.getBoundingClientRect = () => {
    reads++;
    return new page.window.DOMRect(0, height - 20, 100, 20);
  };
  // The frame installs its content-sizing observer before the overlay observer.
  const sizing = new page.window.MutationObserver(() => {
    page.window.requestAnimationFrame(() => {
      height = 500;
    });
  });
  sizing.observe(block, { childList: true });
  const stop = page.start();
  await page.flush();
  assert.equal(page.targets[0]!.bounds.y, 80);
  block.textContent = "New content";
  await page.flush();
  assert.equal(page.targets[0]!.bounds.y, 480);
  assert.equal(reads, 2);
  height = 600;
  block.dispatchEvent(new page.window.Event("load"));
  await page.flush();
  assert.equal(page.targets[0]!.bounds.y, 580);
  assert.equal(reads, 3);
  stop();
  const cancel = page.start();
  cancel();
  await page.flush();
  assert.equal(reads, 3);
  sizing.disconnect();
  await page.window.happyDOM.close();
});

void test("animated inline styles are measured at intervals and published only when targets move", async () => {
  const page = fixture();
  page.document.body.innerHTML =
    '<div data-camox-block-id="block"><div class="marquee"></div></div>';
  const block = page.document.querySelector("[data-camox-block-id]")!;
  const marquee = page.document.querySelector(".marquee")!;
  let y = 0;
  let reads = 0;
  block.getBoundingClientRect = () => {
    reads++;
    return new page.window.DOMRect(0, y, 100, 20);
  };
  const stop = page.start();
  await page.flush();
  const updates = page.updates;
  const target = page.targets[0];

  // A burst of animation frames, each its own mutation batch.
  for (let frame = 0; frame < 5; frame++) {
    marquee.setAttribute("style", `transform: translateX(${frame}px)`);
    await new Promise((resolve) => page.window.requestAnimationFrame(resolve));
  }
  await page.flush();
  assert.equal(reads, 2, "a burst is measured once, after it");
  assert.equal(page.updates, updates, "content that moved no target publishes nothing");
  assert.equal(page.targets[0], target);

  y = 30;
  block.setAttribute("style", "transform: translateY(30px)");
  await page.flush();
  assert.equal(page.targets[0]!.bounds.y, 30, "the last animation frame is measured");
  assert.equal(page.updates, updates + 1);
  stop();
  await page.window.happyDOM.close();
});

void test("hidden Detached copies cannot steal navbar highlights from visible content", async () => {
  const page = fixture();
  page.document.body.innerHTML = `
    <div id="block" data-camox-block-id="navbar" data-camox-focused data-camox-hovered>
      <nav><span id="title" data-camox-field-id="navbar__title"></span></nav>
      <div style="opacity: 0">
        <nav id="floating" data-camox-block-id="navbar" data-camox-focused data-camox-hovered>
          <span id="floating-title" data-camox-field-id="navbar__title"></span>
        </nav>
      </div>
    </div>`;
  let visibilityReads = 0;
  for (const element of page.document.querySelectorAll(
    "[data-camox-block-id], [data-camox-field-id]",
  )) {
    element.getBoundingClientRect = () =>
      new page.window.DOMRect(0, element.id.startsWith("floating") ? -100 : 0, 300, 64);
    element.getClientRects = () =>
      [element.getBoundingClientRect()] as unknown as ReturnType<typeof element.getClientRects>;
    const checkVisibility = element.checkVisibility.bind(element);
    element.checkVisibility = (options) => {
      visibilityReads++;
      return checkVisibility(options);
    };
  }
  const stop = page.start();
  const highlighted = (state: "hovered" | "focused") =>
    page.targets.filter((target) => target[state]).map((target) => target.element.id);
  try {
    await page.flush();
    assert.deepEqual(highlighted("hovered"), ["block"]);
    assert.deepEqual(highlighted("focused"), ["block"]);
    const initialReads = visibilityReads;
    for (const id of ["title", "floating-title"]) {
      page.document.getElementById(id)!.setAttribute("data-camox-focused", "");
      page.document.getElementById(id)!.setAttribute("data-camox-hovered", "");
    }
    await page.flush();
    assert.deepEqual(highlighted("hovered"), ["title"]);
    assert.deepEqual(highlighted("focused"), ["title"]);
    assert.equal(
      visibilityReads,
      initialReads,
      "interaction uses cached visibility, not layout reads",
    );

    // CSS changes invalidate eligibility even when the selection stays the same.
    page.document.getElementById("floating")!.parentElement!.setAttribute("style", "opacity: 1");
    await page.flush();
    assert.deepEqual(highlighted("focused"), ["floating-title"]);
    page.document.getElementById("floating")!.parentElement!.setAttribute("style", "display: none");
    await page.flush();
    assert.deepEqual(highlighted("focused"), ["title"]);
  } finally {
    stop();
    await page.window.happyDOM.close();
  }
});

const idle: RepeatableItemState = {
  hovered: false,
  focused: false,
  hoverGroup: null,
  synced: false,
};

/** Mirrors what React 19.3 records for a Fragment ref over `elements`. */
function fakeFragment(elements: Element[], rects: () => DOMRect[]) {
  const fragment = { getClientRects: rects } as unknown as FragmentInstance;
  for (const element of elements) {
    const owned = element as Element & { reactFragments?: Set<FragmentInstance> };
    owned.reactFragments ??= new Set();
    owned.reactFragments.add(fragment);
  }
  return fragment;
}

void test("repeatable items are measured across their elements without a wrapper", async () => {
  const page = fixture();
  page.document.body.innerHTML = `
    <div data-camox-block-id="specs">
      <dl>
        <dt id="label" data-camox-field-id="specs__7__label">Weight</dt>
        <dd id="value">2 kg</dd>
      </dl>
    </div>`;
  const label = page.document.getElementById("label")!;
  const value = page.document.getElementById("value")!;
  let fragmentReads = 0;
  const fragment = fakeFragment([label, value] as unknown as Element[], () => {
    fragmentReads++;
    return [
      new page.window.DOMRect(0, 0, 100, 20),
      new page.window.DOMRect(120, 0, 80, 20),
      new page.window.DOMRect(200, 0, 0, 20),
    ] as unknown as DOMRect[];
  });
  const document = page.document as unknown as Document;
  const registration = registerRepeatableItem(document, {
    ...idle,
    fragment,
    blockId: 3,
    itemId: 7,
    nesting: 0,
  });
  const stop = page.start();
  const item = () => page.targets.find((target) => target.item);
  const field = () => page.targets.find((target) => target.element.id === "label" && !target.item);
  try {
    await page.flush();
    assert.equal(page.document.querySelectorAll("dl > *").length, 2);
    assert.deepEqual(item()!.item, { blockId: 3, itemId: 7 });
    assert.equal(item()!.element, label);
    assert.deepEqual(item()!.rects, [
      { x: 0, y: 0, width: 100, height: 20 },
      { x: 120, y: 0, width: 80, height: 20 },
    ]);
    assert.deepEqual(item()!.bounds, { x: 0, y: 0, width: 200, height: 20 });

    // Item state changes only rerank cached geometry.
    registration.update({ ...idle, hovered: true, focused: true });
    await page.flush();
    assert.equal(fragmentReads, 1);
    assert.equal(item()!.hovered, true);
    assert.equal(item()!.focused, true);

    // A field rendered as the item's own element still outranks the item.
    label.setAttribute("data-camox-hovered", "");
    await page.flush();
    assert.equal(field()!.hovered, true);
    assert.equal(item()!.hovered, false);
    assert.equal(item()!.focused, true);

    registration.unregister();
    await page.flush();
    assert.equal(item(), undefined);
  } finally {
    stop();
    registration.unregister();
    await page.window.happyDOM.close();
  }
});

void test("a sidebar-hovered repeater highlights every item in its group", async () => {
  const page = fixture();
  page.document.body.innerHTML = `
    <ul data-camox-block-id="links"><li id="first"></li><li id="second"></li></ul>`;
  const document = page.document as unknown as Document;
  const registrations = ["first", "second"].map((id, index) => {
    const element = page.document.getElementById(id)! as unknown as Element;
    const fragment = fakeFragment([element], () => [
      new page.window.DOMRect(0, index * 20, 100, 20) as unknown as DOMRect,
    ]);
    return registerRepeatableItem(document, {
      ...idle,
      fragment,
      blockId: 1,
      itemId: index,
      nesting: 0,
    });
  });
  const stop = page.start();
  try {
    await page.flush();
    for (const registration of registrations) {
      registration.update({ ...idle, hovered: true, hoverGroup: "links" });
    }
    await page.flush();
    assert.deepEqual(
      page.targets.filter((target) => target.hovered).map((target) => target.item?.itemId),
      [0, 1],
    );
  } finally {
    stop();
    for (const registration of registrations) registration.unregister();
    await page.window.happyDOM.close();
  }
});
