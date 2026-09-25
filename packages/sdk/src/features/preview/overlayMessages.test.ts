import assert from "node:assert/strict";
import { test } from "node:test";

import { selectionHoverMessage } from "./overlayMessages";
import type { Selection } from "./previewStore";

const cases: {
  name: string;
  selection: Selection;
  type: string;
  target: Record<string, string>;
}[] = [
  {
    name: "block",
    selection: { type: "block", blockId: 1 },
    type: "CAMOX_HOVER_BLOCK",
    target: { blockId: "1" },
  },
  {
    name: "repeater item",
    selection: { type: "item", blockId: 1, itemId: 2 },
    type: "CAMOX_HOVER_REPEATER_ITEM",
    target: { blockId: "1", itemId: "2" },
  },
  {
    name: "block field",
    selection: { type: "block-field", blockId: 1, fieldName: "image", fieldType: "Image" },
    type: "CAMOX_HOVER_FIELD",
    target: { fieldId: "1__image" },
  },
  {
    name: "item field",
    selection: { type: "item-field", blockId: 1, itemId: 2, fieldName: "link", fieldType: "Link" },
    type: "CAMOX_HOVER_FIELD",
    target: { fieldId: "1__2__link" },
  },
  {
    name: "repeater",
    selection: { type: "block-field", blockId: 1, fieldName: "items", fieldType: "Repeater" },
    type: "CAMOX_HOVER_REPEATER",
    target: { blockId: "1", fieldName: "items" },
  },
  {
    name: "nested repeater",
    selection: {
      type: "item-field",
      blockId: 1,
      itemId: 2,
      fieldName: "children",
      fieldType: "Repeater",
    },
    type: "CAMOX_HOVER_REPEATER",
    target: { blockId: "1", fieldName: "children" },
  },
];

for (const { name, selection, type, target } of cases) {
  void test(`${name} breadcrumb hover starts and ends on the same preview target`, () => {
    assert.deepEqual(selectionHoverMessage(selection, true), { type, ...target });
    assert.deepEqual(selectionHoverMessage(selection, false), { type: `${type}_END`, ...target });
  });
}
