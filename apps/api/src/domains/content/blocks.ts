import { eq, inArray, or, type SQL } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { contentToMarkdown, stripArtifactSources } from "../../lib/content-markdown";
import { blocks, repeatableItems } from "../../schema";
import { injectRepeatableItemMarkers, nestChildItems } from "../_shared/block-markers";
import { type Conformed, conformBlocks } from "../_shared/conform-content";
import { collectFileIds, itemSchemas } from "../_shared/fields";
import { withSharedContent } from "../blocks/shared-content";
import type { ContentScope } from "../collections/identity";
import * as overlay from "../drafts/overlay";
import type { FileView } from "../files/generated-metadata";
import { readValues } from "../generated-values/service";
import { blocksOfLayout } from "../layouts/identity";
import { itemsUnder, type ItemRoot, rootOfItem } from "../repeatable-items/roots";
import type { BlockDefinition, Definitions } from "./definitions";
import { loadFiles } from "./files";
import {
  attachFiles,
  type Holder,
  recordFileIds,
  resolveReferences,
  type ResolvedReferences,
} from "./references";

type BlockRow = typeof blocks.$inferSelect;
type ItemRow = typeof repeatableItems.$inferSelect;

/**
 * The blocks a read covers: those placed on a page, those in a layout's slots, and blocks the
 * caller already holds. A page and its layout are read together.
 */
export type BlockSource = readonly (
  | { pageId: string }
  | { layoutId: string }
  | { block: BlockRow }
)[];

// D1 binds at most 100 parameters per statement.
const CHUNK = 90;

const selectChunked = <T extends overlay.ContentTable>(
  db: Database,
  at: ContentScope,
  table: T,
  ids: readonly string[],
  where: (chunk: string[]) => SQL,
) =>
  Effect.gen(function* () {
    const rows: T["$inferSelect"][] = [];
    for (let start = 0; start < ids.length; start += CHUNK) {
      rows.push(
        ...(yield* overlay.select(db, at.draft, table, where(ids.slice(start, start + CHUNK)))),
      );
    }
    return rows;
  });

/** The stored blocks of a source as the scope reads them, by position, with their items. */
const loadSource = Effect.fn("content.loadSource")(function* (
  db: Database,
  at: ContentScope,
  source: BlockSource,
) {
  const owners = source.flatMap((entry): SQL[] => {
    if ("pageId" in entry) return [eq(blocks.pageId, entry.pageId)];
    if ("layoutId" in entry) {
      return [blocksOfLayout({ projectId: at.projectId, layoutId: entry.layoutId })!];
    }
    return [];
  });
  const held = source.flatMap((entry) => ("block" in entry ? [entry.block] : []));
  const placed = owners.length ? yield* overlay.select(db, at.draft, blocks, or(...owners)) : [];
  const byId = new Map([...held, ...placed].map((block) => [block.id, block]));
  const sorted = overlay.sortByPosition([...byId.values()]);
  const items = yield* selectChunked(
    db,
    at,
    repeatableItems,
    sorted.map((block) => block.id),
    (chunk) => inArray(repeatableItems.blockId, chunk),
  );
  return { blocks: sorted, items };
});

/** A block as readers see it: its shared content if it's a synced placement, and its summary. */
export type ShownBlock = Conformed<BlockRow> & { summary: string };

/** An item as readers see it, under the block showing it, with its summary. */
export type ShownItem = Conformed<ItemRow> & { blockId: string; summary: string };

/**
 * Blocks and items as the scope's readers see them: synced placements show their shared
 * content and items, each carries its summary, and everything is conformed to the block
 * definitions in effect (ADR 0007). Items come in position order.
 */
const show = Effect.fn("content.show")(function* (
  db: Database,
  at: ContentScope,
  definitions: Definitions,
  blockRows: readonly BlockRow[],
  itemRows: readonly ItemRow[],
): Effect.fn.Return<{ blocks: ShownBlock[]; items: ShownItem[] }> {
  const shown = yield* withSharedContent(db, at.draft, blockRows, itemRows);
  const conformed = conformBlocks(yield* definitions.blocks(), shown.blocks, shown.items);
  return {
    blocks: conformed.blocks,
    items: overlay.sortByPosition(conformed.items),
  };
});

/** Blocks as readers see them, in the order given, without their items. */
export const shownBlocks = Effect.fn("content.shownBlocks")(function* (
  db: Database,
  at: ContentScope,
  definitions: Definitions,
  rows: readonly BlockRow[],
) {
  if (rows.length === 0) return [];
  return (yield* show(db, at, definitions, rows, [])).blocks;
});

/** Each item's content schema, from its block's definition and its repeater path. */
function itemContentSchemas(
  definitions: ReadonlyMap<string, BlockDefinition>,
  shownBlocks: readonly { id: string; type: string }[],
  items: readonly { id: string; blockId: string; parentItemId: string | null; fieldName: string }[],
) {
  const byBlock = Map.groupBy(items, (item) => item.blockId);
  const schemas = new Map<string, unknown>();
  for (const block of shownBlocks) {
    const root = definitions.get(block.type)?.contentSchema;
    for (const [id, { content }] of itemSchemas(root, byBlock.get(block.id) ?? [])) {
      schemas.set(id, content);
    }
  }
  return schemas;
}

/**
 * The records shown blocks and items link, two hops deep, and every file they place: one query
 * per hop, one per query-backed list, and one for the files.
 */
const linksAndFiles = Effect.fn("content.linksAndFiles")(function* (
  db: Database,
  at: ContentScope,
  definitions: Definitions,
  shown: { blocks: readonly ShownBlock[]; items: readonly ShownItem[] },
) {
  const blockDefinitions = yield* definitions.blocks();
  const schemas = itemContentSchemas(blockDefinitions, shown.blocks, shown.items);
  const holders: Holder[] = [
    ...shown.blocks.map((block) => ({
      schema: blockDefinitions.get(block.type)?.contentSchema,
      content: block.content,
    })),
    ...shown.items.map((item) => ({ schema: schemas.get(item.id), content: item.content })),
  ];
  const linked = yield* resolveReferences(db, at, definitions, holders, 2);
  const fileIds = new Set<string>();
  for (const value of [...shown.blocks, ...shown.items]) collectFileIds(value.content, fileIds);
  recordFileIds(linked.records, fileIds);
  const files = fileIds.size ? yield* loadFiles(db, at, fileIds) : new Map<string, FileView>();
  attachFiles(linked.records, files);
  const references = linked.references;
  return {
    blockReferences: references.slice(0, shown.blocks.length),
    itemReferences: references.slice(shown.blocks.length),
    files,
  };
});

export type BlockBundle = {
  /** By position, each with `{ _itemId }` markers for its repeaters and its resolved links. */
  blocks: (ShownBlock & { references: ResolvedReferences })[];
  /** Grouped by block, by position within it, with markers for nested repeaters. */
  repeatableItems: (ShownItem & { references: ResolvedReferences })[];
  files: FileView[];
};

/** Blocks with their items, the records they link and the files they place. */
export const blockBundle = Effect.fn("content.blockBundle")(function* (
  db: Database,
  at: ContentScope,
  definitions: Definitions,
  source: BlockSource,
): Effect.fn.Return<BlockBundle> {
  const stored = yield* loadSource(db, at, source);
  const shown = yield* show(db, at, definitions, stored.blocks, stored.items);
  const linked = yield* linksAndFiles(db, at, definitions, shown);
  const itemReferences = new Map(
    shown.items.map((item, index) => [item.id, linked.itemReferences[index]!]),
  );
  const itemsByBlock = Map.groupBy(shown.items, (item) => item.blockId);
  const marked = shown.blocks.map((block, index) => {
    const { block: markedBlock, items } = injectRepeatableItemMarkers<ShownBlock, ShownItem>(
      block,
      itemsByBlock.get(block.id) ?? [],
    );
    return {
      block: { ...markedBlock, references: linked.blockReferences[index]! },
      items: items.map((item) => ({ ...item, references: itemReferences.get(item.id)! })),
    };
  });
  return {
    blocks: marked.map(({ block }) => block),
    repeatableItems: marked.flatMap(({ items }) => items),
    files: [...linked.files.values()],
  } satisfies BlockBundle;
});

/** One block's Markdown Representation, or its JSON when its definition declares none. */
export type BlockMarkdown = {
  id: string;
  pageId: string | null;
  slot: "before" | "after" | null;
  position: string;
  /** Undefined when the block's definition declares no Markdown. */
  markdown: string | undefined;
  /** The block's content, artifact sources replaced by their titles (ADR 0002). */
  json: string;
};

/**
 * The Markdown Representation of each block, by position, with its items nested in its
 * content, its links and its files. Blocks whose definition is gone render nothing.
 */
export const blockMarkdown = Effect.fn("content.blockMarkdown")(function* (
  db: Database,
  at: ContentScope,
  definitions: Definitions,
  source: BlockSource,
) {
  const stored = yield* loadSource(db, at, source);
  const shown = yield* show(db, at, definitions, stored.blocks, stored.items);
  const linked = yield* linksAndFiles(db, at, definitions, shown);
  const blockDefinitions = yield* definitions.blocks();
  const items = shown.items.map((item, index) => ({
    ...item,
    references: linked.itemReferences[index],
  }));
  nestChildItems(items);
  const topItemsByBlock = Map.groupBy(
    items.filter((item) => item.parentItemId === null),
    (item) => item.blockId,
  );
  return shown.blocks.flatMap((block, index): BlockMarkdown[] => {
    const definition = blockDefinitions.get(block.type);
    if (!definition) return [];
    const schema = definition.contentSchema as {
      properties?: Record<string, unknown>;
      toMarkdown?: readonly string[];
    } | null;
    const content = block.content as Record<string, unknown>;
    const json = JSON.stringify(stripArtifactSources(schema?.properties, content));
    const entry = {
      id: block.id,
      pageId: block.pageId,
      slot: block.slot,
      position: block.position,
      json,
    };
    if (!schema?.toMarkdown || !schema.properties) return [{ ...entry, markdown: undefined }];
    const withItems = { ...content };
    const blockItems = topItemsByBlock.get(block.id) ?? [];
    for (const fieldName of new Set(blockItems.map((item) => item.fieldName))) {
      withItems[fieldName] = blockItems.filter((item) => item.fieldName === fieldName);
    }
    const markdown = contentToMarkdown(schema.toMarkdown, schema.properties, withItems, {
      settings: block.settings as Record<string, unknown> | null | undefined,
      files: linked.files,
      references: linked.blockReferences[index],
    });
    return [{ ...entry, markdown: `<!-- ${definition.title} -->\n${markdown}` }];
  });
});

/** The block definitions shaping item trees, by root, and every item in those trees. */
const loadTrees = Effect.fn("content.loadTrees")(function* (
  db: Database,
  at: ContentScope,
  roots: readonly ItemRoot[],
) {
  const blockIds = roots.flatMap((root) => ("blockId" in root ? [root.blockId] : []));
  const rootBlocks = yield* selectChunked(db, at, blocks, blockIds, (chunk) =>
    inArray(blocks.id, chunk),
  );
  const typeOf = new Map(rootBlocks.map((block) => [block.id, block.type]));
  const keyOf = (root: ItemRoot) =>
    "blockId" in root ? root.blockId : `shared:${root.sharedContent.type}`;
  const distinct = [...new Map(roots.map((root) => [keyOf(root), root])).values()];
  const trees = yield* overlay.select(
    db,
    at.draft,
    repeatableItems,
    or(...distinct.map((root) => itemsUnder(root))),
  );
  // Each tree conforms under a stand-in block of its definition, keyed by its root.
  const standIns = distinct.flatMap((root) => {
    const type = "blockId" in root ? typeOf.get(root.blockId) : root.sharedContent.type;
    if (type === undefined) return [];
    return [{ id: keyOf(root), type, content: {}, settings: null }];
  });
  const items = trees.map((item) => ({ ...item, blockId: keyOf(rootOfItem(item)) }));
  return { standIns, items, keyOf };
});

/**
 * Items as readers see them, in the order given, under their stored block: conformed through
 * their repeater path, with their summaries. An item the definitions no longer show, under a
 * removed repeater or block definition, has no content or settings.
 */
export const shownItems = Effect.fn("content.shownItems")(function* (
  db: Database,
  at: ContentScope,
  definitions: Definitions,
  rows: readonly ItemRow[],
) {
  if (rows.length === 0) return [];
  const trees = yield* loadTrees(db, at, rows.map(rootOfItem));
  const conformed = conformBlocks(yield* definitions.blocks(), trees.standIns, trees.items);
  const byId = new Map(conformed.items.map((item) => [item.id, item]));
  const summaries = yield* readValues(
    db,
    at.draft,
    "repeatableItem",
    "summary",
    rows.map((row) => row.id),
  );
  return rows.map((row) => {
    const found = byId.get(row.id);
    return {
      ...row,
      content: found ? found.content : {},
      settings: found ? found.settings : null,
      summary: summaries.get(row.id)?.value?.summary ?? "",
    };
  });
});

/**
 * One item with markers for its nested repeaters, the records it links and the files it
 * places. Undefined when the definitions no longer show it.
 */
export const itemBundle = Effect.fn("content.itemBundle")(function* (
  db: Database,
  at: ContentScope,
  definitions: Definitions,
  row: ItemRow,
) {
  const trees = yield* loadTrees(db, at, [rootOfItem(row)]);
  const blockDefinitions = yield* definitions.blocks();
  const conformed = conformBlocks(blockDefinitions, trees.standIns, trees.items);
  const tree = overlay.sortByPosition(conformed.items);
  const found = tree.find((item) => item.id === row.id);
  if (!found) return undefined;
  const marked = injectRepeatableItemMarkers({ id: found.blockId, content: {} }, tree).items;
  const content = marked.find((item) => item.id === row.id)!.content;
  const schemas = itemContentSchemas(blockDefinitions, trees.standIns, tree);
  const summaries = yield* readValues(db, at.draft, "repeatableItem", "summary", [row.id]);
  const linked = yield* resolveReferences(
    db,
    at,
    definitions,
    [{ schema: schemas.get(row.id), content }],
    2,
  );
  const fileIds = new Set<string>();
  collectFileIds(content, fileIds);
  recordFileIds(linked.records, fileIds);
  const files = fileIds.size ? yield* loadFiles(db, at, fileIds) : new Map<string, FileView>();
  attachFiles(linked.records, files);
  return {
    item: {
      ...found,
      content,
      blockId: row.blockId,
      summary: summaries.get(row.id)?.value?.summary ?? "",
      references: linked.references[0]!,
    },
    files: [...files.values()],
  };
});
