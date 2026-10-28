import assert from "node:assert/strict";
import { test } from "node:test";

import type { NormalizedCollectionRecord, NormalizedItem } from "../../lib/normalized-data";
import { editorSelectionOf } from "./useEditorSelection";

const item = (id: string, summary: string) => ({ id, summary }) as unknown as NormalizedItem;
const record = (id: string, title: string) =>
  ({ id, title, collectionId: "people" }) as unknown as NormalizedCollectionRecord;
const schema = { properties: { title: { title: "Headline" } } };

void test("a block's field reads as the block's name then the field's title, with their ids", () => {
  const selection = editorSelectionOf({
    selection: { type: "block-field", blockId: "b1", fieldName: "title", fieldType: "String" },
    block: { title: "Hero" },
    items: [],
    schema,
    records: [],
  });

  assert.deepEqual(selection, {
    path: ["Hero", "Headline"],
    blockId: "b1",
    fieldName: "title",
  });
});

void test("a nested repeatable item reads through every item above it", () => {
  const selection = editorSelectionOf({
    selection: { type: "item", blockId: "b1", itemId: "i2" },
    block: { title: "Pricing" },
    items: [item("i1", "Pro plan"), item("i2", "Unlimited seats")],
    records: [],
  });

  assert.deepEqual(selection, {
    path: ["Pricing", "Pro plan", "Unlimited seats"],
    blockId: "b1",
    itemId: "i2",
  });
});

void test("a record another record links is the one the agent reads", () => {
  const selection = editorSelectionOf({
    selection: {
      type: "record-field",
      blockId: "b1",
      fieldName: "article",
      recordId: "r1",
      nested: { fieldName: "author", recordId: "r2" },
      recordFieldName: "bio",
      recordFieldType: "String",
    },
    block: { title: "Featured article" },
    items: [],
    records: [record("r1", "Launch post"), record("r2", "Ada")],
  });

  assert.deepEqual(selection, {
    path: ["Featured article", "Launch post", "Ada", "Bio"],
    blockId: "b1",
    recordId: "r2",
    fieldName: "bio",
  });
});
