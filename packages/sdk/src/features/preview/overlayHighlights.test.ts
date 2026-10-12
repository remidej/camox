import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveOverlayHighlights, type HighlightCandidate } from "./overlayHighlights";

type Candidate = HighlightCandidate & { id: string };

function candidate(id: string, depth: number, state: Partial<HighlightCandidate> = {}): Candidate {
  return { id, depth, hovered: false, focused: false, ...state };
}

function highlighted(candidates: Candidate[]) {
  const { hovered, focused } = resolveOverlayHighlights(candidates);
  return {
    hovered: Array.from(hovered, ({ id }) => id),
    focused: Array.from(focused, ({ id }) => id),
  };
}

void test("one deepest highlight per state, with candidate order breaking ties", () => {
  const block = candidate("block", 1, { hovered: true, focused: true });
  const item = candidate("item", 2, { hovered: true });
  const field = candidate("field", 3, { hovered: true, focused: true });
  const remote = candidate("remote", 2, { hovered: true });
  assert.deepEqual(highlighted([block, item, field, remote]), {
    hovered: ["field"],
    focused: ["field"],
  });

  // Leaving the field restores its hovered parent, without changing selection.
  field.hovered = false;
  assert.deepEqual(highlighted([block, item, field, remote]), {
    hovered: ["item"],
    focused: ["field"],
  });

  // Removing a candidate hands the highlight to the next deepest one.
  assert.deepEqual(highlighted([block, remote]), { hovered: ["remote"], focused: ["block"] });
  assert.deepEqual(highlighted([]), { hovered: [], focused: [] });
});

void test("repeater hover highlights its whole group and preserves individual selection", () => {
  const block = candidate("block", 1, { hovered: true });
  const first = candidate("first", 2, { hovered: true, hoverGroup: "list" });
  const field = candidate("field", 3);
  const second = candidate("second", 3, { hovered: true, hoverGroup: "list", focused: true });
  const all = [block, first, field, second];

  // Group membership, not equal DOM depth, identifies the repeater's items.
  assert.deepEqual(highlighted(all), { hovered: ["first", "second"], focused: ["second"] });

  field.hovered = true;
  field.depth = 4;
  assert.deepEqual(highlighted(all).hovered, ["field"]);
  field.hovered = false;
  assert.deepEqual(highlighted(all).hovered, ["first", "second"]);

  // Ending group hover must restore individual hover even when the item's raw
  // hovered state stays true throughout the transition.
  first.hoverGroup = null;
  second.hoverGroup = null;
  first.hovered = false;
  assert.deepEqual(highlighted(all), { hovered: ["second"], focused: ["second"] });
  second.hovered = false;
  assert.deepEqual(highlighted(all).hovered, ["block"]);
});

void test("Detached targets cannot outrank their own fields", () => {
  const block = candidate("block", 1, { focused: true });
  const border = candidate("border", 2, { focused: true });
  const icon = candidate("icon", 3, { focused: true });
  assert.deepEqual(highlighted([block, border, icon]).focused, ["icon"]);
  icon.focused = false;
  assert.deepEqual(highlighted([block, border, icon]).focused, ["border"]);
});
