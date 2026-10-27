import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";
import { renderToString } from "react-dom/server";

Object.assign(globalThis, { React });
const { Squareling } = await import("./Squareling");

const AGENT_BODY =
  '<path d="M20 12H80Q88 12 88 20V64Q88 88 64 88H20Q12 88 12 80V20Q12 12 20 12Z" class="fill-emerald-500"></path>';

void test("the agent's squareling is drawn as it was before patrollers had their own", () => {
  const svg = (status: string, eyes: string) =>
    `<svg viewBox="0 0 100 100" aria-hidden="true" data-squareling="${status}" class="squareling shrink-0 overflow-visible"><g class="squareling-body">${AGENT_BODY}<g class="squareling-eyes fill-neutral-950">${eyes}</g></g></svg>`;
  const open =
    '<rect class="squareling-eye" x="50" y="36" width="11" height="17"></rect><rect class="squareling-eye" x="69" y="36" width="11" height="17"></rect>';

  assert.equal(renderToString(<Squareling status="idle" />), svg("idle", open));
  assert.equal(renderToString(<Squareling status="thinking" />), svg("thinking", open));
  assert.equal(
    renderToString(<Squareling status="acting" />),
    svg(
      "acting",
      '<rect x="50" y="44" width="11" height="6"></rect><rect x="69" y="44" width="11" height="6"></rect>',
    ),
  );
  assert.equal(
    renderToString(<Squareling status="fixing" />),
    svg(
      "fixing",
      '<rect x="50" y="36" width="11" height="17"></rect><rect x="69" y="44" width="11" height="6"></rect>',
    ),
  );
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
