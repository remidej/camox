import assert from "node:assert/strict";
import { test } from "node:test";

import { createBlock, Type } from "./createBlock";

const options = {
  id: "navigation",
  title: "Navigation",
  description: "Site navigation",
  content: { title: Type.String({ default: "Home" }) },
  component: function Navigation() {
    return null;
  },
  toMarkdown: (content: { title: string }) => [content.title],
};

void test("synced defaults to false", () => {
  assert.equal(createBlock(options)._internal.synced, false);
  assert.equal(createBlock({ ...options, synced: false })._internal.synced, false);
});

void test("synced is independent of layoutOnly", () => {
  const pageBlock = createBlock({ ...options, synced: true });
  assert.equal(pageBlock._internal.synced, true);
  assert.equal(pageBlock._internal.layoutOnly, false);
  const layoutBlock = createBlock({ ...options, synced: true, layoutOnly: true });
  assert.equal(layoutBlock._internal.synced, true);
  assert.equal(layoutBlock._internal.layoutOnly, true);
});
