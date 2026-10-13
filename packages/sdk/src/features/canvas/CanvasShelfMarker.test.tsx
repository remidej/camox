import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import type { Block } from "../../core/createBlock";
import { getCanvasShelves, positionCanvasShelves } from "./canvasItems";
import type { CanvasPage } from "./canvasPages";
import { CanvasShelfMarkers } from "./CanvasShelfMarker";

const pages: CanvasPage[] = [
  { key: "page:1", title: "Home", pathname: "/", pageId: 1 },
  { key: "page:2", title: "About", pathname: "/about", pageId: 2 },
];
const blocks = ["Hero", "FAQ"].map(
  (title) => ({ _internal: { id: title.toLowerCase(), title, layoutOnly: false } }) as Block,
);

const CSS_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  calc: (value) => value!,
  min: Math.min,
  max: Math.max,
  clamp: (min, value, max) => Math.max(min!, Math.min(value!, max!)),
};

/** Evaluates a CSS length expression of the camera and sidebar variables, in screen px. */
function evaluateCss(
  expression: string,
  camera: { x: number; zoom: number; sidebarLeft?: number },
) {
  const tokens = expression
    .replace(/var\(--canvas-x, [^)]*\)/g, String(camera.x))
    .replace(/var\(--canvas-sidebar-left, [^)]*\)/g, `${camera.sidebarLeft ?? 0}px`)
    .replace(/var\(--canvas-zoom, [^)]*\)/g, String(camera.zoom))
    .match(/[a-z]+\(|-?[\d.]+(?:px)?|[-+*/(),]/g)!;
  let position = 0;
  const next = () => tokens[position++]!;
  const operand = (): number => {
    const token = next();
    if (token === "(") return argumentsUntilClose()[0]!;
    if (token.endsWith("(")) return CSS_FUNCTIONS[token.slice(0, -1)]!(...argumentsUntilClose());
    return Number.parseFloat(token);
  };
  const product = () => {
    let value = operand();
    while (tokens[position] === "*" || tokens[position] === "/") {
      value = next() === "*" ? value * operand() : value / operand();
    }
    return value;
  };
  const sum = () => {
    let value = product();
    while (tokens[position] === "+" || tokens[position] === "-") {
      value = next() === "+" ? value + product() : value - product();
    }
    return value;
  };
  const argumentsUntilClose = () => {
    const values = [sum()];
    while (next() === ",") values.push(sum());
    return values;
  };
  return sum();
}

/** The first argument of a `translate(x, y)` transform. */
function translateX(transform: string) {
  const args = transform.slice("translate(".length, -1);
  let depth = 0;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "(") depth++;
    if (args[index] === ")") depth--;
    if (args[index] === "," && depth === 0) return args.slice(0, index);
  }
  throw new Error(`Not a translate: ${transform}`);
}

void test("Shelf Marker bars never overlap and collapsed bars keep their thickness, at any zoom", async () => {
  const dom = new Window({ url: "http://localhost/camox" });
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  try {
    const rows = {
      "two filled areas": positionCanvasShelves(getCanvasShelves(pages, blocks)),
      "an empty Blocks area": positionCanvasShelves(getCanvasShelves(pages, [])),
      "a collapsed Pages area": positionCanvasShelves(
        getCanvasShelves(pages, blocks),
        new Set(["shelf:pages"]),
      ),
      "a collapsed Pages area and an empty Blocks area": positionCanvasShelves(
        getCanvasShelves(pages, []),
        new Set(["shelf:pages"]),
      ),
    };
    for (const [scenario, { markers }] of Object.entries(rows)) {
      await act(async () =>
        root.render(<CanvasShelfMarkers markers={markers} onToggle={() => {}} />),
      );
      const bars = [...mount.querySelectorAll("[data-canvas-shelf-marker]")].map((bar) => ({
        collapsed: bar.getAttribute("aria-expanded") === "false",
        style: (bar as unknown as HTMLElement).style,
        label: (
          mount.querySelector(
            `[data-canvas-shelf-marker-label="${bar.getAttribute("data-canvas-shelf-marker")}"]`,
          ) as unknown as HTMLElement
        ).style,
      }));
      assert.equal(bars.length, 2, scenario);
      const thickness = (style: CSSStyleDeclaration, zoom: number) =>
        evaluateCss(style.width, { x: 64, zoom });
      for (const zoom of [0.01, 0.03, 0.05, 0.1, 0.4, 1, 2]) {
        const camera = { x: 64, zoom };
        for (const { collapsed, style } of bars) {
          if (!collapsed) continue;
          assert.equal(
            thickness(style, zoom),
            thickness(style, 1),
            `${scenario}: a collapsed bar keeps its thickness at zoom ${zoom}`,
          );
        }
        const [first, second] = bars.map(({ style }) => {
          const left = evaluateCss(translateX(style.transform), camera);
          return { left, right: left + evaluateCss(style.width, camera) };
        });
        assert.ok(
          first!.right < second!.left,
          `${scenario} at zoom ${zoom}: ${first!.right} overlaps ${second!.left}`,
        );
        for (const [index, { collapsed, label }] of bars.entries()) {
          if (collapsed) continue;
          const labelLeft = evaluateCss(translateX(label.transform), camera);
          const bar = [first, second][index]!;
          assert.ok(
            labelLeft > bar.left,
            `${scenario} at zoom ${zoom}: the label at ${labelLeft} starts outside its bar at ${bar.left}`,
          );
        }
      }
    }
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
});

void test("an expanded Shelf Marker's label sticks past the left sidebar", async () => {
  const dom = new Window({ url: "http://localhost/camox" });
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  try {
    const { markers } = positionCanvasShelves(getCanvasShelves(pages, blocks));
    await act(async () =>
      root.render(<CanvasShelfMarkers markers={markers} onToggle={() => {}} />),
    );
    const label = mount.querySelector(
      '[data-canvas-shelf-marker-label="shelf:pages"]',
    ) as unknown as HTMLElement;
    const labelLeft = (camera: { x: number; zoom: number; sidebarLeft: number }) =>
      evaluateCss(translateX(label.style.transform), camera);
    // Zoomed in on the area's middle: its start is far off to the left.
    const scrolled = { x: -1000, zoom: 1 };
    const withoutSidebar = labelLeft({ ...scrolled, sidebarLeft: 0 });
    for (const sidebarLeft of [120, 250]) {
      assert.equal(
        labelLeft({ ...scrolled, sidebarLeft }),
        withoutSidebar + sidebarLeft,
        `the label keeps its inset from a ${sidebarLeft}px sidebar's edge`,
      );
    }
    // In view past the sidebar, the label stays at its area's start.
    const inView = { x: 400, zoom: 1 };
    assert.equal(
      labelLeft({ ...inView, sidebarLeft: 250 }),
      labelLeft({ ...inView, sidebarLeft: 0 }),
    );
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
});
