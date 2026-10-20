import assert from "node:assert/strict";
import { test } from "node:test";

import { REVEAL_MARGIN, REVEAL_VISIBLE_SHARE, revealScrollDelta } from "./selectionReveal";

const view = { top: 0, bottom: 1000 };

void test("an item that mostly shows does not scroll", () => {
  assert.equal(revealScrollDelta({ top: 100, bottom: 400 }, view), 0);
  // Cut off by the bottom edge, but only by less than the share it needs.
  const height = 400;
  const cut = height * (1 - REVEAL_VISIBLE_SHARE) - 1;
  assert.equal(revealScrollDelta({ top: 1000 - height + cut, bottom: 1000 + cut }, view), 0);
});

void test("an item mostly below the view scrolls its bottom in, above it its top", () => {
  assert.equal(
    revealScrollDelta({ top: 900, bottom: 1300 }, view),
    1300 - view.bottom + REVEAL_MARGIN,
  );
  assert.equal(revealScrollDelta({ top: -350, bottom: 50 }, view), -350 - REVEAL_MARGIN);
});

void test("an item taller than the view counts as shown while it covers enough of the view", () => {
  assert.equal(revealScrollDelta({ top: -500, bottom: 1500 }, view), 0);
  // Below and too tall to fit: show its top rather than its bottom.
  assert.equal(revealScrollDelta({ top: 800, bottom: 3000 }, view), 800 - REVEAL_MARGIN);
});

void test("the view's position applies, not just its height", () => {
  const offset = { top: 2000, bottom: 3000 };
  assert.equal(revealScrollDelta({ top: 2100, bottom: 2400 }, offset), 0);
  assert.equal(revealScrollDelta({ top: 100, bottom: 400 }, offset), 100 - 2000 - REVEAL_MARGIN);
});
