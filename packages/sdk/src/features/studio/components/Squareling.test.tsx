import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";
import { renderToString } from "react-dom/server";

Object.assign(globalThis, { React });
const { Squareling } = await import("./Squareling");

void test("the agent's eyes are open while idle or thinking, both narrowed while acting, and only the right one while fixing", () => {
  const [left, right] = drawn(<Squareling status="idle" />).eyes;
  assert.ok(left !== undefined && right !== undefined);

  assert.deepEqual(drawn(<Squareling status="thinking" />).eyes, [left, right]);
  const acting = drawn(<Squareling status="acting" />).eyes;
  assert.equal(acting.length, 2);
  assert.ok(acting[0]! < left && acting[1]! < right, "acting narrows both eyes");
  const fixing = drawn(<Squareling status="fixing" />).eyes;
  assert.equal(fixing.length, 2);
  assert.equal(fixing[0], left, "fixing keeps the left eye open");
  assert.ok(fixing[1]! < right, "fixing narrows the right eye");
});

/** Reads a squareling's body: its silhouette and its color, and its eyes' heights. */
function drawn(element: React.ReactElement) {
  const { document } = new Window();
  document.body.innerHTML = renderToString(element);
  const body = document.querySelector(".squareling-body > path")!;
  return {
    silhouette: body.getAttribute("d"),
    color: body.getAttribute("class"),
    eyes: [...document.querySelectorAll(".squareling-eyes rect")].map((eye) =>
      Number(eye.getAttribute("height")),
    ),
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
