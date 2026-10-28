import type { EditorSelection, EditorWhere } from "@camox/api-contract/threads";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import {
  type NormalizedCollectionRecord,
  type NormalizedItem,
  type NormalizedReferences,
  placedRecords,
} from "../../lib/normalized-data";
import { useBlockDefinition, useCollectionDefinition } from "../../lib/studio-definitions";
import { reads, useReadQuery } from "../../lib/studio-reads";
import { contentFieldSchema } from "../preview/components/contentFieldSchema";
import { formatFieldName } from "../preview/components/ItemFieldsEditor";
import { getSchemaForItem } from "../preview/components/SelectionEditor";
import { entityName } from "../preview/entityName";
import {
  type EditingOwner,
  isBlockPlacement,
  type Selection,
  selectionBlockId,
  selectionForOwner,
  selectionItemId,
} from "../preview/previewStore";
import { previewStore } from "../preview/previewStore";

/** The owner the page the editor looks at edits, as the editing frame names it. */
function ownerOf(where: EditorWhere | undefined): EditingOwner | null {
  if (where?.on !== "page") return null;
  if (where.layoutId != null) return { kind: "layout", layoutId: where.layoutId };
  if (where.pageId != null) return { kind: "page", pageId: where.pageId };
  return null;
}

type Owned = { references?: NormalizedReferences };

/** What the selection is made of, as the studio has it loaded. */
export type SelectionParts = {
  selection: Selection;
  block?: { title?: string };
  /** The repeatable items from the block down to the selected one. */
  items: NormalizedItem[];
  /** The item's content schema, or the block's with no item. */
  schema?: unknown;
  /** The records the selection shows, the placed one then the one it links. */
  records: NormalizedCollectionRecord[];
  recordSchema?: unknown;
};

/** The selection as the agent reads it, from the parts the studio loaded. */
export function editorSelectionOf({
  selection,
  block,
  items,
  schema,
  records,
  recordSchema,
}: SelectionParts): EditorSelection {
  const fieldLabel = (fieldSchema: unknown, fieldName: string) =>
    contentFieldSchema(fieldSchema, fieldName)?.title ?? formatFieldName(fieldName);
  const path: string[] = [];
  // Every selection but a record a layout places is inside a block.
  const blockId = selectionBlockId(selection) ?? undefined;
  if (blockId) path.push(block?.title ?? "Block");
  for (const item of items) path.push(entityName(item, "Item"));
  const recordSelected = selection.type === "record" || selection.type === "record-field";
  if (recordSelected) {
    path.push(
      ...(records.length > 0 ? records.map((record) => record.title || "Record") : ["Record"]),
    );
  }
  let fieldName: string | undefined;
  if (selection.type === "block-field" || selection.type === "item-field") {
    fieldName = selection.fieldName;
    path.push(fieldLabel(schema, fieldName));
  } else if (selection.type === "record-field") {
    fieldName = selection.recordFieldName;
    path.push(fieldLabel(recordSchema, fieldName));
  }
  const itemId = selectionItemId(selection) ?? undefined;
  const recordId = recordSelected ? (selection.nested?.recordId ?? selection.recordId) : undefined;
  return {
    path,
    ...(blockId ? { blockId } : {}),
    ...(itemId ? { itemId } : {}),
    ...(recordId ? { recordId } : {}),
    ...(fieldName ? { fieldName } : {}),
  };
}

/**
 * What the editor has selected on the page they look at, as the agent reads it, or undefined
 * with nothing selected there.
 */
export function useEditorSelection(where: EditorWhere | undefined): EditorSelection | undefined {
  const owner = ownerOf(where);
  const selection = useSelector(previewStore, (state) => selectionForOwner(state.context, owner));
  const blockId = selectionBlockId(selection);
  const itemId = selectionItemId(selection);
  const { data: bundle } = useReadQuery(reads.blockBundle(blockId!), { enabled: blockId != null });
  const blockDef = useBlockDefinition(bundle?.block.type);

  const itemsMap = React.useMemo(
    () => new Map((bundle?.repeatableItems ?? []).map((item) => [item.id, item])),
    [bundle?.repeatableItems],
  );
  const items: NormalizedItem[] = [];
  for (let item = itemId ? itemsMap.get(itemId) : undefined; item;) {
    items.unshift(item);
    item = item.parentItemId ? itemsMap.get(item.parentItemId) : undefined;
  }
  const schema =
    blockDef && itemId
      ? getSchemaForItem(blockDef.contentSchema, itemId, itemsMap)
      : blockDef?.contentSchema;

  // The records a block or repeatable item places, then the one that record links.
  const records: NormalizedCollectionRecord[] = [];
  if (
    (selection?.type === "record" || selection?.type === "record-field") &&
    isBlockPlacement(selection)
  ) {
    const placer: Owned | undefined = itemId ? items.at(-1) : bundle?.block;
    const outer = placedRecords(placer?.references, selection.fieldName).find(
      (record) => record.id === selection.recordId,
    );
    if (outer) records.push(outer);
    const { nested } = selection;
    const linked =
      nested &&
      placedRecords(outer?.references, nested.fieldName).find(
        (record) => record.id === nested.recordId,
      );
    if (linked) records.push(linked);
  }
  const recordSchema = useCollectionDefinition(records.at(-1)?.collectionId)?.contentSchema;

  if (!selection) return undefined;
  return editorSelectionOf({
    selection,
    block: blockDef,
    items,
    schema,
    records,
    recordSchema,
  });
}
