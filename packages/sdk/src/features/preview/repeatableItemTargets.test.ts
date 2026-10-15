import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import type { FragmentInstance } from "react";

import { closestRepeatableItem, registerRepeatableItem } from "./repeatableItemTargets";

const idle = { hovered: false, focused: false, hoverGroup: null, synced: false };

function own(fragment: FragmentInstance, ...elements: Element[]) {
  for (const element of elements) {
    const owned = element as Element & { reactFragments?: Set<FragmentInstance> };
    owned.reactFragments ??= new Set();
    owned.reactFragments.add(fragment);
  }
}

void test("hit-testing finds the innermost item and stops at the enclosing block", async () => {
  const window = new Window();
  window.document.body.innerHTML = `
    <section id="outer-block" data-camox-block-id="1">
      <article id="row">
        <p id="text">Text</p>
        <div data-camox-block-id="2"><span id="nested-block-content"></span></div>
      </article>
    </section>`;
  const document = window.document as unknown as Document;
  const element = (id: string) => document.getElementById(id)!;
  // An item that renders a nested repeater directly shares its elements with it.
  const outer = {} as FragmentInstance;
  const inner = {} as FragmentInstance;
  own(outer, element("row"));
  own(inner, element("row"));
  const registrations = [
    registerRepeatableItem(document, {
      ...idle,
      fragment: inner,
      blockId: "1",
      itemId: "2",
      nesting: 1,
    }),
    registerRepeatableItem(document, {
      ...idle,
      fragment: outer,
      blockId: "1",
      itemId: "1",
      nesting: 0,
    }),
  ];
  try {
    assert.equal(closestRepeatableItem(element("text"))?.itemId, "2");
    assert.equal(closestRepeatableItem(element("nested-block-content")), undefined);
    assert.equal(closestRepeatableItem(element("outer-block")), undefined);
    registrations[0]!.unregister();
    assert.equal(closestRepeatableItem(element("text"))?.itemId, "1");
  } finally {
    for (const registration of registrations) registration.unregister();
    await window.happyDOM.close();
  }
});
