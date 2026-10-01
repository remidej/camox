import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Window } from "happy-dom";

import {
  COMMENT_CURSOR_COLOR,
  COMMENT_CURSOR_STYLES,
  COMMENT_CURSOR_SYNCED_COLOR,
} from "./commentCursor";

void test("comment cursor colors match the overlay palette", () => {
  const css = readFileSync(new URL("./studio-overlays.css", import.meta.url), "utf8");
  for (const color of [COMMENT_CURSOR_COLOR, COMMENT_CURSOR_SYNCED_COLOR]) {
    assert.ok(css.includes(`--camox-overlay-color-selected: ${color};`));
    assert.ok(decodeURIComponent(COMMENT_CURSOR_STYLES).includes(`fill="${color}"`));
  }
});

void test("cursor inherits the nearest overlay mode and defaults to pink", async () => {
  const window = new Window();
  const { document } = window;
  document.head.innerHTML = `<style>${COMMENT_CURSOR_STYLES}</style>`;
  document.body.innerHTML = `
    <div id="page"></div>
    <div data-camox-overlay-mode="synced">
      <span id="synced"></span>
      <div data-camox-overlay-mode="local"><span id="local"></span></div>
    </div>
    <div data-camox-overlay-mode="reference"><span id="reference"></span></div>
  `;
  try {
    for (const [id, color] of [
      ["page", COMMENT_CURSOR_COLOR],
      ["local", COMMENT_CURSOR_COLOR],
      ["synced", COMMENT_CURSOR_SYNCED_COLOR],
      ["reference", COMMENT_CURSOR_SYNCED_COLOR],
    ]) {
      const cursor = window.getComputedStyle(document.getElementById(id!)!).cursor;
      assert.ok(decodeURIComponent(cursor).includes(`fill="${color}"`), `${id}: ${cursor}`);
      assert.ok(cursor.endsWith("1 23, crosshair"));
    }
  } finally {
    await window.happyDOM.close();
  }
});
