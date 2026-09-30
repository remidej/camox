import assert from "node:assert/strict";
import { test } from "node:test";

import type { Comment, CommentTarget } from "@camox/api-contract";
import { Window } from "happy-dom";
import * as React from "react";

import {
  CanvasCommentIndicators,
  canvasCommentGroupDistance,
  canvasCommentIndicators,
  canvasCommentSeparationZoom,
  groupCanvasCommentIndicators,
} from "./CanvasCommentIndicators";
import type { CanvasOverlayTarget } from "./canvasOverlayGeometry";

function comment(
  id: string,
  target: CommentTarget | null,
  options: { resolved?: boolean; author?: string } = {},
): Comment {
  return {
    id,
    pageId: 7,
    environmentId: 1,
    message: `Message ${id}`,
    resolved: options.resolved ?? false,
    target,
    author: { name: options.author ?? "Ada Lovelace", image: null },
    createdAt: 1,
  };
}

function field(
  document: Document,
  fieldId: string,
  x: number,
  y: number,
  visible = true,
): CanvasOverlayTarget {
  const element = document.createElement("span");
  element.setAttribute("data-camox-field-id", fieldId);
  return {
    element,
    bounds: { x, y, width: 100, height: 20 },
    rects: [{ x, y, width: 100, height: 20 }],
    visible,
    hovered: false,
    focused: false,
    synced: false,
    inline: true,
  };
}

void test("maps unresolved field comments to exact visible field geometry", async () => {
  const window = new Window();
  const targets = [
    field(window.document as unknown as Document, "12__title", 20, 40),
    field(window.document as unknown as Document, "12__title", 500, 40, false),
    field(window.document as unknown as Document, "12__34__label", 30, 160),
  ];
  const comments = [
    comment("block-field", { kind: "block-field", blockId: 12, fieldName: "title" }),
    comment("item-field", {
      kind: "item-field",
      blockId: 12,
      itemId: 34,
      fieldName: "label",
    }),
    comment(
      "resolved",
      { kind: "block-field", blockId: 12, fieldName: "title" },
      { resolved: true },
    ),
    comment("block", { kind: "block", blockId: 12 }),
    comment("missing", { kind: "block-field", blockId: 12, fieldName: "missing" }),
  ];

  assert.deepEqual(
    canvasCommentIndicators(comments, targets).map(({ comment: entry, x, y }) => ({
      id: entry.id,
      x,
      y,
    })),
    [
      { id: "block-field", x: 20, y: 40 },
      { id: "item-field", x: 30, y: 160 },
    ],
  );
  await window.happyDOM.close();
});

void test("groups nearby comments transitively while preserving distant field anchors", async () => {
  const window = new Window();
  const indicators = canvasCommentIndicators(
    [
      comment("a", { kind: "block-field", blockId: 1, fieldName: "a" }),
      comment("b", { kind: "block-field", blockId: 1, fieldName: "b" }),
      comment("c", { kind: "block-field", blockId: 1, fieldName: "c" }),
      comment("d", { kind: "block-field", blockId: 1, fieldName: "d" }),
    ],
    [
      field(window.document as unknown as Document, "1__a", 10, 100),
      field(window.document as unknown as Document, "1__b", 60, 150),
      field(window.document as unknown as Document, "1__c", 110, 200),
      field(window.document as unknown as Document, "1__d", 400, 200),
    ],
  );
  const groups = groupCanvasCommentIndicators(indicators, { x: 60, y: 60 });
  assert.deepEqual(
    groups.map((group) => ({
      comments: group.indicators.map((indicator) => indicator.comment.id),
      x: group.x,
      y: group.y,
    })),
    [
      { comments: ["a", "b", "c"], x: 10, y: 100 },
      { comments: ["d"], x: 400, y: 200 },
    ],
  );
  await window.happyDOM.close();
});

void test("nearby copies of one field do not duplicate a comment in its group", async () => {
  const window = new Window();
  const indicators = canvasCommentIndicators(
    [comment("one", { kind: "block-field", blockId: 12, fieldName: "title" })],
    [
      field(window.document as unknown as Document, "12__title", 10, 100),
      field(window.document as unknown as Document, "12__title", 40, 100),
    ],
  );
  assert.equal(indicators.length, 2, "each visible field copy has an anchor");
  const groups = groupCanvasCommentIndicators(indicators);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0]!.indicators.map((indicator) => indicator.comment.id),
    ["one"],
  );
  await window.happyDOM.close();
});

void test("zooming out groups comments that separate again when zooming in", async () => {
  const window = new Window();
  const indicators = canvasCommentIndicators(
    [
      comment("left", { kind: "block-field", blockId: 1, fieldName: "left" }),
      comment("right", { kind: "block-field", blockId: 1, fieldName: "right" }),
    ],
    [
      field(window.document as unknown as Document, "1__left", 20, 40),
      field(window.document as unknown as Document, "1__right", 120, 40),
    ],
  );

  assert.equal(groupCanvasCommentIndicators(indicators, canvasCommentGroupDistance(0.3)).length, 1);
  assert.equal(groupCanvasCommentIndicators(indicators, canvasCommentGroupDistance(1)).length, 2);
  const separatedZoom = canvasCommentSeparationZoom(indicators, 0.3);
  assert.ok(separatedZoom > 0.3);
  assert.equal(
    groupCanvasCommentIndicators(indicators, canvasCommentGroupDistance(separatedZoom)).length,
    2,
  );
  await window.happyDOM.close();
});

void test("renders a clickable comment above its field in the host overlay", async () => {
  const window = new Window();
  const globals = {
    React,
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    navigator: window.navigator,
    getComputedStyle: window.getComputedStyle.bind(window),
    ResizeObserver: window.ResizeObserver,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(window.document.body as unknown as HTMLElement);
  const selected: string[] = [];
  const zooms: { point: { x: number; y: number }; scale: number }[] = [];
  try {
    await React.act(async () => {
      root.render(
        <CanvasCommentIndicators
          comments={[
            comment(
              "comment-1",
              { kind: "block-field", blockId: 12, fieldName: "title" },
              { author: "Grace Hopper" },
            ),
          ]}
          targets={[field(window.document as unknown as Document, "12__title", 20, 40)]}
          onSelect={(entry) => selected.push(entry.id)}
        />,
      );
    });
    const group = window.document.querySelector(
      "[data-canvas-comment-group]",
    ) as unknown as HTMLElement;
    assert.equal(group.style.left, "calc(20px * var(--canvas-zoom, 1))");
    assert.equal(group.style.top, "calc(40px * var(--canvas-zoom, 1))");
    const button = group.querySelector("button")!;
    assert.equal(button.getAttribute("aria-label"), "View comment from Grace Hopper on title");
    assert.ok(button.querySelector("[data-comment-cursor]"));
    assert.ok(button.querySelector('[data-slot="avatar"]'));
    assert.ok(
      button.querySelector('[data-slot="avatar-fallback"]')?.classList.contains("bg-muted"),
    );
    assert.equal(
      button.querySelector("path")?.getAttribute("d"),
      "M16 1a15 15 0 0 1 0 30H1V16A15 15 0 0 1 16 1Z",
    );
    assert.equal(button.querySelector("path")?.getAttribute("stroke"), null);
    assert.ok(button.querySelector("path")?.classList.contains("fill-primary"));
    await React.act(async () => button.click());
    assert.deepEqual(selected, ["comment-1"]);

    await React.act(async () => {
      root.render(
        <CanvasCommentIndicators
          comments={[
            comment("comment-1", { kind: "block-field", blockId: 12, fieldName: "title" }),
            comment(
              "comment-2",
              { kind: "block-field", blockId: 12, fieldName: "subtitle" },
              { author: "Katherine Johnson" },
            ),
          ]}
          targets={[
            field(window.document as unknown as Document, "12__title", 20, 40),
            field(window.document as unknown as Document, "12__subtitle", 60, 60),
          ]}
          onZoom={(point, scale) => zooms.push({ point, scale })}
          onSelect={(entry) => selected.push(entry.id)}
        />,
      );
    });
    const trigger = window.document.querySelector(
      '[aria-label="Zoom in to separate 2 nearby comments"]',
    )!;
    assert.equal(trigger.querySelector("[data-comment-count]")?.textContent, "2");
    assert.ok(trigger.querySelector("[data-comment-cursor]"));
    assert.equal(trigger.hasAttribute("data-canvas-overlay-control"), true);
    await React.act(async () => {
      trigger.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, clientX: 100, clientY: 120 }),
      );
    });
    assert.deepEqual(selected, ["comment-1"]);
    assert.deepEqual(
      zooms.map(({ point }) => point),
      [{ x: 100, y: 120 }],
    );
    assert.ok(Math.abs(zooms[0]!.scale - 1.89) < 1e-8);

    await React.act(async () => {
      root.render(
        <CanvasCommentIndicators
          comments={[
            comment("comment-1", { kind: "block-field", blockId: 12, fieldName: "title" }),
            comment("comment-2", { kind: "block-field", blockId: 12, fieldName: "title" }),
          ]}
          targets={[field(window.document as unknown as Document, "12__title", 20, 40)]}
          onZoom={(point, scale) => zooms.push({ point, scale })}
          onSelect={(entry) => selected.push(entry.id)}
        />,
      );
    });
    const sameField = window.document.querySelector('[aria-label="View 2 comments on title"]')!;
    const avatarGroup = sameField.querySelector("[data-canvas-comment-avatar-group]")!;
    assert.equal(avatarGroup.querySelectorAll('[data-slot="avatar"]').length, 2);
    assert.equal(sameField.querySelector("[data-comment-count]"), null);
    assert.ok(sameField.hasAttribute("data-comment-cursor-capsule"));
    assert.ok(sameField.classList.contains("bg-primary"));
    assert.equal((sameField as unknown as HTMLElement).style.borderBottomLeftRadius, "0px");
    await React.act(async () => {
      sameField.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    assert.deepEqual(selected, ["comment-1", "comment-1"]);
    assert.equal(zooms.length, 1);
  } finally {
    await React.act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
