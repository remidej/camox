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
      { id: "block-field", x: 120, y: 40 },
      { id: "item-field", x: 130, y: 160 },
    ],
  );
  await window.happyDOM.close();
});

void test("maps blocks and nested repeatable items to their own visible top-right anchors", async () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const block = field(document, "", 10, 20);
  block.element.setAttribute("data-camox-block-id", "12");
  const item = field(document, "", 30, 100);
  item.element.setAttribute("data-camox-repeatable-item-id", "34");
  block.element.appendChild(item.element);
  const nested = field(document, "", 40, 200);
  nested.element.setAttribute("data-camox-repeatable-item-id", "35");
  item.element.appendChild(nested.element);
  const hidden = { ...block, visible: false };
  const comments = [
    comment("block", { kind: "block", blockId: 12 }),
    comment("item", { kind: "item", blockId: 12, itemId: 34 }),
    comment("nested", { kind: "item", blockId: 12, itemId: 35 }),
    comment("wrong-owner", { kind: "item", blockId: 99, itemId: 34 }),
    comment("missing", { kind: "block", blockId: 99 }),
    comment("resolved", { kind: "block", blockId: 12 }, { resolved: true }),
    comment("page", { kind: "page" }),
    comment("deleted", null),
  ];
  assert.deepEqual(
    canvasCommentIndicators(comments, [block, item, nested, hidden]).map(({ comment, x, y }) => ({
      id: comment.id,
      x,
      y,
    })),
    [
      { id: "block", x: 110, y: 20 },
      { id: "item", x: 130, y: 100 },
      { id: "nested", x: 140, y: 200 },
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
      { comments: ["a", "b", "c"], x: 110, y: 100 },
      { comments: ["d"], x: 500, y: 200 },
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

void test("renders a rounded clickable comment inset from its field's top-right corner", async () => {
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
    assert.equal(group.style.left, "calc(120px * var(--canvas-zoom, 1) - 4px)");
    assert.equal(group.style.top, "calc(40px * var(--canvas-zoom, 1) + 4px)");
    const button = group.querySelector("button")!;
    assert.ok(button.classList.contains("block"), "no inline baseline gap below the indicator");
    assert.equal(button.querySelector("svg"), null);
    assert.equal(group.style.transform, "translateX(-100%)");
    assert.equal(button.getAttribute("aria-label"), "View comment from Grace Hopper on title");
    const avatar = button.querySelector("[data-comment-indicator-avatar]")!;
    assert.ok(avatar.classList.contains("rounded-full"));
    assert.ok(avatar.classList.contains("bg-[var(--camox-overlay-color-selected)]"));
    assert.ok(
      avatar.querySelector('[data-slot="avatar-group"] [data-slot="avatar"]'),
      "single indicators use the same avatar ring as grouped indicators",
    );
    assert.ok(button.querySelector('[data-slot="avatar"]'));
    assert.ok(
      button.querySelector('[data-slot="avatar-fallback"]')?.classList.contains("bg-muted"),
    );
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
    assert.ok(trigger.querySelector("[data-comment-indicator-avatar]"));
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
    assert.ok(sameField.hasAttribute("data-comment-capsule"));
    assert.ok(sameField.classList.contains("bg-[var(--camox-overlay-color-selected)]"));
    assert.ok(sameField.classList.contains("rounded-full"));
    assert.equal((sameField as unknown as HTMLElement).style.borderBottomLeftRadius, "");
    await React.act(async () => {
      sameField.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    assert.deepEqual(selected, ["comment-1", "comment-1"]);
    assert.equal(zooms.length, 1);

    for (const target of [
      { kind: "block", blockId: 12 },
      { kind: "item", blockId: 12, itemId: 34 },
      { kind: "page" },
    ] satisfies CommentTarget[]) {
      const anchor = field(window.document as unknown as Document, "", 20, 40);
      anchor.synced = true;
      anchor.element.setAttribute("data-camox-block-id", "12");
      if (target.kind === "item")
        anchor.element.setAttribute("data-camox-repeatable-item-id", "34");
      const label = target.kind === "item" ? "repeatable item" : target.kind;
      for (const count of [1, 2]) {
        await React.act(async () => {
          root.render(
            <CanvasCommentIndicators
              comments={[
                ...Array.from({ length: count }, (_, index) => comment(`new-${index}`, target)),
                comment("resolved", target, { resolved: true }),
                comment("deleted", null),
                ...(target.kind === "page"
                  ? [comment("not-page", { kind: "block", blockId: 12 })]
                  : [comment("not-preview", { kind: "page" })]),
              ]}
              targets={[anchor]}
              placement={target.kind === "page" ? "header" : "preview"}
              onSelect={(entry) => selected.push(entry.id)}
            />,
          );
        });
        const groups = window.document.querySelectorAll("[data-canvas-comment-group]");
        assert.equal(groups.length, 1);
        const group = groups[0] as unknown as HTMLElement;
        assert.equal(
          group.getAttribute("data-camox-overlay-mode"),
          target.kind === "page" ? null : "synced",
        );
        assert.equal(group.style.position, target.kind === "page" ? "" : "absolute");
        assert.equal(
          group.style.display,
          target.kind === "page" ? "var(--canvas-overlays-display, block)" : "",
          "page comments follow the camera's shared overlay visibility",
        );
        assert.equal(group.style.transform, target.kind === "page" ? "" : "translateX(-100%)");
        const button = group.querySelector("button")!;
        assert.equal(
          button.getAttribute("aria-label"),
          count === 1
            ? `View comment from Ada Lovelace on ${label}`
            : `View 2 comments on ${label}`,
        );
        await React.act(async () => button.click());
        assert.equal(selected.at(-1), "new-0");
      }
    }
  } finally {
    await React.act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
