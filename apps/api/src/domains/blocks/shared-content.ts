import { queryKeys } from "@camox/api-contract/query-keys";
import { and, eq, inArray, max } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { bumpContentUpdatedAtForBlocks } from "../../lib/bump-content-updated-at";
import { blocks, repeatableItems, sharedContents } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { visibleIn } from "../drafts/overlay";
import {
  itemsUnder,
  rootColumns,
  rootOfItem,
  type DefinitionKey,
  type ItemRoot,
} from "../repeatable-items/roots";
import { findDefinition } from "./content-schema";
import { prepareBlockContent } from "./prepare-content";

/**
 * A synced block definition's shared content (ADR 0004, 0005) is one entity per definition name
 * and environment. Every placement of the definition shows it, and placements hold only their
 * identity, position and slot. A definition is synced exactly while its shared content exists:
 * definition syncs create and delete it (ADR 0007).
 */

type BlockRow = typeof blocks.$inferSelect;
type ItemRow = typeof repeatableItems.$inferSelect;
export type SharedContentRow = typeof sharedContents.$inferSelect;

/** The shared content of a definition. */
export function sharedContentWhere(key: DefinitionKey) {
  return and(
    eq(sharedContents.environmentId, key.environmentId),
    eq(sharedContents.type, key.type),
  )!;
}

/** The Live placements of a definition. Shared content stays in Live until #238. */
function placementsWhere(key: DefinitionKey) {
  return and(
    visibleIn(blocks, null),
    eq(blocks.environmentId, key.environmentId),
    eq(blocks.type, key.type),
  )!;
}

/** The definition a block places. */
export function definitionOf(block: { environmentId: number; type: string }): DefinitionKey {
  return { environmentId: block.environmentId, type: block.type };
}

const findSharedContent = Effect.fn("findSharedContent")(function* (
  db: Database,
  key: DefinitionKey,
) {
  return yield* Effect.promise(() =>
    db.select().from(sharedContents).where(sharedContentWhere(key)).get(),
  );
});

const insertSharedContent = Effect.fn("insertSharedContent")(function* (
  db: Database,
  key: DefinitionKey,
  data: { content: unknown; settings: unknown; summary: string },
) {
  const now = Date.now();
  yield* Effect.promise(() =>
    db.insert(sharedContents).values({ ...key, ...data, createdAt: now, updatedAt: now }),
  );
});

/**
 * Where a block's content, settings and items live: its synced definition's shared content, or
 * the block itself.
 */
export const contentOwnerOf = Effect.fn("contentOwnerOf")(function* (
  db: Database,
  block: { id: string; environmentId: number; type: string },
) {
  const key = definitionOf(block);
  const shared = yield* findSharedContent(db, key);
  const root: ItemRoot = shared ? { sharedContent: key } : { blockId: block.id };
  return { shared: shared ?? null, root };
});

/** The placements of a definition, oldest first. */
export const placementsOf = Effect.fn("placementsOf")(function* (db: Database, key: DefinitionKey) {
  return yield* Effect.promise(() =>
    db.select().from(blocks).where(placementsWhere(key)).orderBy(blocks.id),
  );
});

/**
 * Blocks and items as readers see them. A placement of a synced definition shows the shared
 * content, settings and summary, and the shared items, each named under the placement's
 * `blockId`: shared items keep their ids, so several placements read the same item ids.
 */
export const withSharedContent = Effect.fn("withSharedContent")(function* <B extends BlockRow>(
  db: Database,
  blockRows: readonly B[],
  itemRows: readonly ItemRow[],
) {
  const environmentIds = [...new Set(blockRows.map((block) => block.environmentId))];
  const types = [...new Set(blockRows.map((block) => block.type))];
  const ownItems = (items: readonly ItemRow[]) =>
    items.filter((item): item is ItemRow & { blockId: string } => item.blockId !== null);
  if (blockRows.length === 0) return { blocks: [...blockRows], items: ownItems(itemRows) };

  const shared = yield* Effect.promise(() =>
    db
      .select()
      .from(sharedContents)
      .where(
        and(
          inArray(sharedContents.environmentId, environmentIds),
          inArray(sharedContents.type, types),
        ),
      ),
  );
  if (shared.length === 0) return { blocks: [...blockRows], items: ownItems(itemRows) };
  const keyOf = ({ environmentId, type }: DefinitionKey) => `${environmentId}:${type}`;
  const sharedByKey = new Map(shared.map((row) => [keyOf(row), row]));
  const sharedItems = yield* Effect.promise(() =>
    db
      .select()
      .from(repeatableItems)
      .where(
        and(
          inArray(repeatableItems.environmentId, environmentIds),
          inArray(
            repeatableItems.sharedContentType,
            shared.map((row) => row.type),
          ),
        ),
      ),
  );
  const itemsByKey = new Map<string, ItemRow[]>();
  for (const item of sharedItems) {
    const root = rootOfItem(item);
    if (!("sharedContent" in root)) continue;
    const itemKey = keyOf(root.sharedContent);
    if (!sharedByKey.has(itemKey)) continue;
    itemsByKey.set(itemKey, [...(itemsByKey.get(itemKey) ?? []), item]);
  }

  const placed = new Set<string>();
  const projectedBlocks = blockRows.map((block) => {
    const content = sharedByKey.get(keyOf(block));
    if (!content) return block;
    placed.add(block.id);
    return {
      ...block,
      content: content.content,
      settings: content.settings,
      summary: content.summary,
    };
  });
  const items = ownItems(itemRows).filter((item) => !placed.has(item.blockId));
  for (const block of blockRows) {
    if (!placed.has(block.id)) continue;
    for (const item of itemsByKey.get(keyOf(block)) ?? []) {
      items.push({ ...item, blockId: block.id });
    }
  }
  return { blocks: projectedBlocks, items };
});

/** A block as readers see it. */
export const shownBlock = Effect.fn("shownBlock")(function* <B extends BlockRow>(
  db: Database,
  block: B,
) {
  return (yield* withSharedContent(db, [block], [])).blocks[0];
});

/** Invalidates every read showing a definition's shared content. */
export function broadcastSharedContentChange(ctx: ServiceContext, projectId: number, type: string) {
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId,
    targets: [
      queryKeys.blocks.getSyncedContent(type),
      queryKeys.pages.getByPathAll,
      queryKeys.pages.list,
      queryKeys.layouts.all,
      ["camox", "blocks", "get"],
      ["camox", "blocks", "getPageMarkdown"],
      ["camox", "repeatableItems", "get"],
    ],
  });
}

/** Bumps the pages and layouts placing a definition, whose content changed with its shared content. */
export const bumpPlacementOwners = Effect.fn("bumpPlacementOwners")(function* (
  db: Database,
  key: DefinitionKey,
) {
  const placements = yield* placementsOf(db, key);
  yield* bumpContentUpdatedAtForBlocks(
    db,
    placements.map((block) => block.id),
  );
});

/** A placement holding nothing of its own: its content lives in the shared content. */
const clearedPlacement = { content: {}, settings: null, summary: "" };

/** Copies an item tree under another root with fresh ids, parents before children. */
const copyItemTree = Effect.fn("copyItemTree")(function* (
  db: Database,
  items: readonly ItemRow[],
  root: ItemRoot,
  now: number,
) {
  const copyChildren = (
    parentId: string | null,
    copiedParentId: string | null,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      for (const item of items.filter((candidate) => candidate.parentItemId === parentId)) {
        const copied = yield* Effect.promise(() =>
          db
            .insert(repeatableItems)
            .values({
              ...rootColumns(root),
              parentItemId: copiedParentId,
              fieldName: item.fieldName,
              content: item.content,
              settings: item.settings,
              summary: item.summary,
              position: item.position,
              createdAt: now,
              updatedAt: now,
            })
            .returning({ id: repeatableItems.id })
            .get(),
        );
        yield* copyChildren(item.id, copied.id);
      }
    });
  yield* copyChildren(null, null);
});

/** The content a definition's defaults give a new block, with its repeatable item seeds. */
const defaultBundle = Effect.fn("defaultBundle")(function* (db: Database, key: DefinitionKey) {
  const definition = yield* findDefinition(db, key);
  return yield* prepareBlockContent(
    definition?.defaultContent ?? undefined,
    definition?.defaultSettings ?? undefined,
    undefined,
    definition?.contentSchema,
    definition?.settingsSchema,
  ).pipe(
    Effect.orElseSucceed(() => ({
      content: {} as Record<string, unknown>,
      settings: null as unknown,
      seeds: [],
    })),
  );
});

/** Shared content from the definition's defaults, with their repeatable items. */
const sharedContentFromDefaults = Effect.fn("sharedContentFromDefaults")(function* (
  db: Database,
  key: DefinitionKey,
) {
  const now = Date.now();
  const defaults = yield* defaultBundle(db, key);
  yield* insertSharedContent(db, key, {
    content: defaults.content,
    settings: defaults.settings ?? null,
    summary: "",
  });
  const ids = new Map<string, string>();
  for (const seed of defaults.seeds) {
    const inserted = yield* Effect.promise(() =>
      db
        .insert(repeatableItems)
        .values({
          ...rootColumns({ sharedContent: key }),
          parentItemId: seed.parentTempId ? (ids.get(seed.parentTempId) ?? null) : null,
          fieldName: seed.fieldName,
          content: seed.content,
          settings: seed.settings ?? null,
          summary: "",
          position: seed.position,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: repeatableItems.id })
        .get(),
    );
    ids.set(seed.tempId, inserted.id);
  }
});

/** Shared content taken from a placement: its content, and its items, which keep their ids. */
const sharedContentFromPlacement = Effect.fn("sharedContentFromPlacement")(function* (
  db: Database,
  placement: BlockRow,
) {
  const key = definitionOf(placement);
  const { content, settings, summary } = placement;
  yield* insertSharedContent(db, key, { content, settings, summary });
  yield* Effect.promise(() =>
    db
      .update(repeatableItems)
      .set(rootColumns({ sharedContent: key }))
      .where(eq(repeatableItems.blockId, placement.id)),
  );
});

/**
 * Becoming synced (ADR 0007): the shared content is taken from the most recently updated
 * placement, items included, or from the definition's defaults when there is none. Every
 * placement's own content is cleared.
 */
const becomeSynced = Effect.fn("becomeSynced")(function* (db: Database, key: DefinitionKey) {
  const placements = yield* placementsOf(db, key);
  if (placements.length === 0) return yield* sharedContentFromDefaults(db, key);

  const placementIds = placements.map((block) => block.id);
  const itemUpdates = yield* Effect.promise(() =>
    db
      .select({ blockId: repeatableItems.blockId, updatedAt: max(repeatableItems.updatedAt) })
      .from(repeatableItems)
      .where(inArray(repeatableItems.blockId, placementIds))
      .groupBy(repeatableItems.blockId),
  );
  const lastUpdate = (block: BlockRow) =>
    Math.max(block.updatedAt, itemUpdates.find((row) => row.blockId === block.id)?.updatedAt ?? 0);
  // Ties go to the newest placement, whose UUIDv7 sorts last.
  const latest = placements.reduce((best, block) =>
    lastUpdate(block) >= lastUpdate(best) ? block : best,
  );
  yield* sharedContentFromPlacement(db, latest);
  yield* Effect.promise(() =>
    db.delete(repeatableItems).where(inArray(repeatableItems.blockId, placementIds)),
  );
  yield* Effect.promise(() => db.update(blocks).set(clearedPlacement).where(placementsWhere(key)));
});

/**
 * No longer synced (ADR 0007): every placement gets its own copy of the shared content, with
 * fresh ids for the copied repeatable items, and the shared content is deleted.
 */
const stopBeingSynced = Effect.fn("stopBeingSynced")(function* (
  db: Database,
  shared: SharedContentRow,
) {
  const now = Date.now();
  const key = definitionOf(shared);
  const root: ItemRoot = { sharedContent: key };
  const items = yield* Effect.promise(() =>
    db.select().from(repeatableItems).where(itemsUnder(root)),
  );
  for (const placement of yield* placementsOf(db, key)) {
    yield* Effect.promise(() =>
      db
        .update(blocks)
        .set({ content: shared.content, settings: shared.settings, summary: shared.summary })
        .where(eq(blocks.rowId, placement.rowId)),
    );
    yield* copyItemTree(db, items, { blockId: placement.id }, now);
  }
  yield* Effect.promise(() => db.delete(repeatableItems).where(itemsUnder(root)));
  yield* Effect.promise(() => db.delete(sharedContents).where(sharedContentWhere(key)));
});

/**
 * Brings a definition's shared content in line with its synced flag: a synced definition
 * without shared content becomes synced, and shared content of a definition that isn't synced
 * is copied back into its placements.
 */
const alignSharedContent = Effect.fn("alignSharedContent")(function* (
  ctx: ServiceContext,
  { projectId, key, synced, seedFromDefaults }: SyncedFlag & { seedFromDefaults: boolean },
) {
  const shared = yield* findSharedContent(ctx.db, key);
  if (shared && !synced) yield* stopBeingSynced(ctx.db, shared);
  if (!shared && synced) {
    const placed = (yield* placementsOf(ctx.db, key)).length > 0;
    if (placed || seedFromDefaults) yield* becomeSynced(ctx.db, key);
  }
  yield* bumpPlacementOwners(ctx.db, key);
  broadcastSharedContentChange(ctx, projectId, key.type);
});

type SyncedFlag = { projectId: number; key: DefinitionKey; synced: boolean };

/** A definition sync changed a definition's synced flag. */
export const applySyncedFlagChange = Effect.fn("blocks.applySyncedFlagChange")(function* (
  ctx: ServiceContext,
  flag: SyncedFlag,
) {
  yield* alignSharedContent(ctx, { ...flag, seedFromDefaults: true });
});

/**
 * A definition sync created a definition, maybe one coming back to content stored under its
 * name. A new synced definition that isn't placed yet gets its shared content from its first
 * placement, like a layout declaring it, rather than from its defaults.
 */
export const applyNewDefinitionSyncedFlag = Effect.fn("blocks.applyNewDefinitionSyncedFlag")(
  function* (ctx: ServiceContext, flag: SyncedFlag) {
    yield* alignSharedContent(ctx, { ...flag, seedFromDefaults: false });
  },
);

/**
 * Makes a new placement show its definition's shared content. The placement's own content seeds
 * the shared content when a synced definition has none yet, and is dropped otherwise.
 */
export const adoptSharedContent = Effect.fn("blocks.adoptSharedContent")(function* (
  ctx: ServiceContext,
  block: BlockRow,
) {
  const key = definitionOf(block);
  // The new row itself, whether in Live or in a draft.
  const clear = Effect.promise(() =>
    ctx.db.update(blocks).set(clearedPlacement).where(eq(blocks.rowId, block.rowId)),
  );
  if (yield* findSharedContent(ctx.db, key)) {
    yield* Effect.promise(() =>
      ctx.db.delete(repeatableItems).where(eq(repeatableItems.blockId, block.id)),
    );
    return yield* clear;
  }
  if (!(yield* findDefinition(ctx.db, key))?.synced) return;
  yield* sharedContentFromPlacement(ctx.db, block);
  yield* clear;
});

/**
 * A placement through which a synced definition's shared content reads. Nothing when the
 * definition isn't synced or isn't placed.
 */
export const sharedPlacementId = Effect.fn("blocks.sharedPlacementId")(function* (
  db: Database,
  key: DefinitionKey,
) {
  if (!(yield* findSharedContent(db, key))) return null;
  const [first] = yield* placementsOf(db, key);
  return first?.id ?? null;
});
