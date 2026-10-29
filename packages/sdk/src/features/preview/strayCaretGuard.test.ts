import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";

import { guardStrayCaret } from "./strayCaretGuard";

/** A block with a heading field, and the text node the browser puts the caret in. */
function page() {
  const dom = new Window();
  const doc = dom.document as unknown as Document;
  doc.body.innerHTML = `
    <div id="block">
      <h1 id="heading"><span id="field" contenteditable="true">Title</span></h1>
      <p id="static">Static text</p>
    </div>`;
  const byId = (id: string) => doc.getElementById(id)!;
  let caret: Node | null = null;
  // happy-dom has no layout: the test says where the caret would land.
  Object.assign(doc, {
    caretPositionFromPoint: () => (caret ? { offsetNode: caret, offset: 0 } : null),
  });
  const press = (target: Element, caretIn: Element | null) => {
    caret = caretIn?.firstChild ?? null;
    const event = new dom.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    target.dispatchEvent(event as unknown as Event);
    return event.defaultPrevented;
  };
  return { doc, byId, press };
}

void test("a click beside a field selects around it instead of editing it", () => {
  const { doc, byId, press } = page();
  const stop = guardStrayCaret(doc);
  const field = byId("field");
  field.focus();
  assert.equal(doc.activeElement, field);

  assert.equal(press(byId("heading"), field), true, "the caret never lands in the field");
  assert.notEqual(doc.activeElement, field, "the field being edited is left");
  stop();
});

void test("clicks the browser handles as usual", () => {
  const { doc, byId, press } = page();
  const stop = guardStrayCaret(doc);

  assert.equal(press(byId("field"), byId("field")), false, "a click in a field edits it");
  assert.equal(press(byId("block"), byId("static")), false, "a click by static text selects it");

  stop();
  assert.equal(press(byId("heading"), byId("field")), false, "stopping the guard restores it");
});
