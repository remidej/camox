import assert from "node:assert/strict";
import { test } from "node:test";

import { createBlock, type ContentFieldBuilder } from "./createBlock";

const options = {
  id: "navigation",
  title: "Navigation",
  description: "Site navigation",
  content: (field: ContentFieldBuilder) => ({ title: field.string({ default: "Home" }) }),
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

void test("rejects fields declared in the wrong context by untyped callers", () => {
  const setting = { fieldType: "Boolean", type: "boolean", default: true };
  const text = { fieldType: "String", type: "string", default: "" };
  assert.throws(
    () => createBlock({ ...options, content: () => ({ visible: setting }) } as never),
    /Boolean is a setting, not content/,
  );
  assert.throws(
    () => createBlock({ ...options, settings: () => ({ label: text }) } as never),
    /setting "label" must be an enum or a boolean/,
  );
});
