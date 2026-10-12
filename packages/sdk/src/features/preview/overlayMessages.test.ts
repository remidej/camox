import assert from "node:assert/strict";
import { test } from "node:test";

import { selectionHoverMessage } from "./overlayMessages";
import type { Selection } from "./previewStore";

const cases: {
  name: string;
  selection: Selection | null;
  type: string;
  target: Record<string, string>;
}[] = [
  { name: "page", selection: null, type: "CAMOX_HOVER_PAGE", target: {} },
  {
    name: "block",
    selection: { type: "block", blockId: 1 },
    type: "CAMOX_HOVER_BLOCK",
    target: { blockId: "1" },
  },
  {
    name: "repeatable item",
    selection: { type: "item", blockId: 1, itemId: 2 },
    type: "CAMOX_HOVER_REPEATABLE_ITEM",
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
  {
    name: "record",
    selection: { type: "record", blockId: 1, fieldName: "company", recordId: "acme" },
    type: "CAMOX_HOVER_FIELD",
    target: { fieldId: "1__company__acme" },
  },
  {
    name: "record field",
    selection: {
      type: "record-field",
      blockId: 1,
      fieldName: "company",
      recordId: "acme",
      recordFieldName: "quote",
      recordFieldType: "String",
    },
    type: "CAMOX_HOVER_FIELD",
    target: { fieldId: "1__company__acme__quote" },
  },
  {
    name: "record placed by an item",
    selection: { type: "record", blockId: 1, itemId: 2, fieldName: "sponsor", recordId: "acme" },
    type: "CAMOX_HOVER_FIELD",
    target: { fieldId: "1__2__sponsor__acme" },
  },
  {
    name: "record field placed by an item",
    selection: {
      type: "record-field",
      blockId: 1,
      itemId: 2,
      fieldName: "sponsor",
      recordId: "acme",
      recordFieldName: "quote",
      recordFieldType: "String",
    },
    type: "CAMOX_HOVER_FIELD",
    target: { fieldId: "1__2__sponsor__acme__quote" },
  },
  {
    name: "record linked by a placed record",
    selection: {
      type: "record",
      blockId: 1,
      fieldName: "article",
      recordId: "launch",
      nested: { fieldName: "author", recordId: "jane" },
    },
    type: "CAMOX_HOVER_FIELD",
    target: { fieldId: "1__article__launch__author__jane" },
  },
  {
    name: "record placed by a layout",
    selection: { type: "record", layoutId: 4, recordId: "launch" },
    type: "CAMOX_HOVER_FIELD",
    target: { fieldId: "layout-4__launch" },
  },
  {
    name: "record field placed by a layout",
    selection: {
      type: "record-field",
      layoutId: 4,
      recordId: "launch",
      recordFieldName: "title",
      recordFieldType: "String",
    },
    type: "CAMOX_HOVER_FIELD",
    target: { fieldId: "layout-4__launch__title" },
  },
  {
    name: "record linked by a record placed by a layout",
    selection: {
      type: "record",
      layoutId: 4,
      recordId: "launch",
      nested: { fieldName: "author", recordId: "jane" },
    },
    type: "CAMOX_HOVER_FIELD",
    target: { fieldId: "layout-4__launch__author__jane" },
  },
];

for (const { name, selection, type, target } of cases) {
  void test(`${name} breadcrumb hover starts and ends on the same preview target`, () => {
    assert.deepEqual(selectionHoverMessage(selection, true), { type, ...target });
    assert.deepEqual(selectionHoverMessage(selection, false), { type: `${type}_END`, ...target });
  });
}

void test("a layout-owned placement and a block-owned placement of the same record are distinct targets", () => {
  const layoutOwned: Selection = { type: "record", layoutId: 4, recordId: "launch" };
  const blockOwned: Selection = {
    type: "record",
    blockId: 4,
    fieldName: "article",
    recordId: "launch",
  };
  assert.notDeepEqual(
    selectionHoverMessage(layoutOwned, true),
    selectionHoverMessage(blockOwned, true),
  );
  const field = { recordFieldName: "title", recordFieldType: "String" } as const;
  assert.notDeepEqual(
    selectionHoverMessage({ ...layoutOwned, type: "record-field", ...field }, true),
    selectionHoverMessage({ ...blockOwned, type: "record-field", ...field }, true),
  );
});
