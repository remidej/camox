import assert from "node:assert/strict";
import { test } from "node:test";

import { isSiteStyle } from "./previewStyles";

void test("studio styles are never copied into the site iframe", () => {
  assert.equal(isSiteStyle({ hasAttribute: (name) => name === "data-camox-studio" }), false);
  assert.equal(isSiteStyle({ hasAttribute: () => false }), true);
});
