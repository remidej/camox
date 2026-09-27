import assert from "node:assert/strict";
import { test } from "node:test";

import { getGridNavigationIndex as move } from "./blockGridNavigation";

void test("grid navigation moves in all four directions without wrapping rows", () => {
  assert.equal(move(4, 9, 3, "ArrowLeft"), 3);
  assert.equal(move(4, 9, 3, "ArrowRight"), 5);
  assert.equal(move(4, 9, 3, "ArrowUp"), 1);
  assert.equal(move(4, 9, 3, "ArrowDown"), 7);
  assert.equal(move(3, 9, 3, "ArrowLeft"), 3);
  assert.equal(move(5, 9, 3, "ArrowRight"), 5);
  assert.equal(move(1, 9, 3, "ArrowUp"), 1);
  assert.equal(move(7, 9, 3, "ArrowDown"), 7);
});

void test("short last rows, empty search results, and missing selection have sensible targets", () => {
  assert.equal(move(5, 7, 3, "ArrowDown"), 6);
  assert.equal(move(6, 7, 3, "ArrowRight"), 6);
  assert.equal(move(-1, 0, 3, "ArrowDown"), -1);
  assert.equal(move(-1, 7, 3, "ArrowDown"), 0);
});

void test("movement responds to the current column count", () => {
  assert.equal(move(1, 8, 3, "ArrowDown"), 4);
  assert.equal(move(1, 8, 2, "ArrowDown"), 3);
  assert.equal(move(1, 8, 1, "ArrowDown"), 2);
  assert.equal(move(1, 8, 1, "ArrowRight"), 1);
});
