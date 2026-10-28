import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";
import { renderToString } from "react-dom/server";

Object.assign(globalThis, { React });
const { Squareling } = await import("./Squareling");

void test("the agent's eyes narrow on the work while it makes changes, only the right one while it fixes, and stay open otherwise", () => {
  const [left, right] = drawn(<Squareling status="idle" />).eyes;
  assert.ok(left !== undefined && right !== undefined);

  for (const status of ["thinking", "exploring", "building"] as const)
    assert.deepEqual(drawn(<Squareling status={status} />).eyes, [left, right], status);
  const changing = drawn(<Squareling status="changing" />).eyes;
  assert.equal(changing.length, 2);
  assert.ok(changing[0]! < left && changing[1]! < right, "making changes narrows both eyes");
  const fixing = drawn(<Squareling status="fixing" />).eyes;
  assert.equal(fixing.length, 2);
  assert.equal(fixing[0], left, "fixing keeps the left eye open");
  assert.ok(fixing[1]! < right, "fixing narrows the right eye");
});

void test("a squareling looks at the editor while idle: its eyes move left, the agent's right to its middle", () => {
  for (const variant of ["agent", "translator", "seoManager"] as const) {
    const { atWork, idle } = gaze(<Squareling variant={variant} status="idle" />);

    assert.ok(atWork > 50, `${variant} looks right like the mark at work`);
    assert.ok(idle < atWork, `${variant} turns to the editor while idle`);
  }
  // The agent's square body is even on both sides, around the drawing's middle.
  assert.equal(gaze(<Squareling status="idle" />).idle, 50);
});

/**
 * Where a squareling's eyes sit across at work, as drawn, and idle, once `studio.css` moved them
 * by `--squareling-towards-us`.
 */
function gaze(element: React.ReactElement) {
  const { document } = new Window();
  document.body.innerHTML = renderToString(element);
  const towardsUs = Number(
    /--squareling-towards-us:\s*(-?[\d.]+)px/.exec(
      document.querySelector("svg")!.getAttribute("style") ?? "",
    )?.[1],
  );
  const eyes = [...document.querySelectorAll(".squareling-eyes rect")].map(
    (eye) => Number(eye.getAttribute("x")) + Number(eye.getAttribute("width")) / 2,
  );
  const atWork = (eyes[0]! + eyes[1]!) / 2;
  return { atWork, idle: atWork + towardsUs };
}

void test("a squareling's face follows what it does once drawn, for `studio.css` to animate", async () => {
  const window = new Window();
  const globals = {
    window,
    document: window.document,
    getComputedStyle: window.getComputedStyle.bind(window),
    matchMedia: window.matchMedia.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const before = Object.fromEntries(
    Object.keys(globals).map((key) => [key, (globalThis as Record<string, unknown>)[key]]),
  );
  Object.assign(globalThis, globals);
  try {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const container = window.document.createElement("div");
    window.document.body.append(container);
    const root = createRoot(container as unknown as Element);
    const face = () => container.querySelector("svg")!.getAttribute("data-face");

    await act(async () => root.render(<Squareling status="idle" />));
    assert.equal(face(), "idle");
    await act(async () => root.render(<Squareling status="exploring" />));
    assert.equal(face(), "exploring");
    await act(async () => root.render(<Squareling status="changing" />));
    assert.equal(face(), "changing");
    await act(async () => root.unmount());
  } finally {
    Object.assign(globalThis, before);
  }
});

/** Reads a squareling's body: its silhouette and its color, and how open its eyes are. */
function drawn(element: React.ReactElement) {
  const { document } = new Window();
  document.body.innerHTML = renderToString(element);
  const body = document.querySelector(".squareling-body > path")!;
  return {
    silhouette: body.getAttribute("d"),
    color: body.getAttribute("class"),
    eyes: [...document.querySelectorAll(".squareling-eyes rect")].map((eye) => {
      // An eye narrows by scaling down its height: `scale: 1 <height>`.
      const scale = /scale:\s*([\d.]+)(?:\s+([\d.]+))?/.exec(eye.getAttribute("style") ?? "");
      return Number(eye.getAttribute("height")) * Number(scale?.[2] ?? scale?.[1] ?? 1);
    }),
  };
}

void test("each patroller has its own silhouette and color, and none is the agent's emerald", () => {
  const agent = drawn(<Squareling status="idle" />);
  const translator = drawn(<Squareling variant="translator" status="idle" />);
  const seoManager = drawn(<Squareling variant="seoManager" status="idle" />);

  const silhouettes = new Set([agent, translator, seoManager].map((each) => each.silhouette));
  const colors = new Set([agent, translator, seoManager].map((each) => each.color));
  assert.equal(silhouettes.size, 3);
  assert.equal(colors.size, 3);
  assert.doesNotMatch(translator.color!, /emerald/);
  assert.doesNotMatch(seoManager.color!, /emerald/);
});

void test("a patroller's eyes are open while idle and narrowed while it works", () => {
  for (const variant of ["translator", "seoManager"] as const) {
    const idle = drawn(<Squareling variant={variant} status="idle" />);
    const working = drawn(<Squareling variant={variant} status="working" />);

    assert.equal(idle.eyes.length, 2);
    assert.equal(working.eyes.length, 2);
    for (const [index, open] of idle.eyes.entries())
      assert.ok(working.eyes[index]! < open, `${variant}'s working eyes are narrower`);
  }
});
