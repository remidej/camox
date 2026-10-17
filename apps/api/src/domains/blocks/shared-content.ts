import { queryKeys } from "@camox/api-contract/query-keys";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { blocks, repeatableItems, sharedContentId, sharedContents } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import * as overlay from "../drafts/overlay";
import { readScopeOf, type DraftScope, type WriteTarget } from "../drafts/scope";
import type { GeneratedEntity } from "../generated-values/schema";
import { readValuesOf } from "../generated-values/service";
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
 * in a project. Every placement of the definition shows it, and placements hold only their
 * identity, position and slot. A definition is synced exactly while its shared content exists:
 * definition syncs create and delete it (ADR 0007).
 *
 * Shared content and its repeatable items live in Live and in drafts like any content: a draft
 * reads its own copy over Live's, and every placement in the draft shows that copy. A release's
 * definition sync writes Live; dev mode's writes the development draft, as draft rows.
 */

type BlockRow = typeof blocks.$inferSelect;
type ItemRow = typeof repeatableItems.$inferSelect;
export type SharedContentRow = typeof sharedContents.$inferSelect;

/** The placements of a definition, as a scope reads them. */
function placementsWhere(key: DefinitionKey) {
  return and(eq(blocks.projectId, key.projectId), eq(blocks.type, key.type))!;
}

/** The definition a block places. */
export function definitionOf(block: { projectId: number; type: string }): DefinitionKey {
  return { projectId: block.projectId, type: block.type };
}

/** A definition's shared content as a scope reads it. */
export const findSharedContent = (db: Database, scope: DraftScope, key: DefinitionKey) =>
  overlay.get(db, scope, sharedContents, sharedContentId(key));

const insertSharedContent = Effect.fn("insertSharedContent")(function* (
  db: Database,
  target: WriteTarget,
  key: DefinitionKey,
  data: { content: unknown; settings: unknown },
) {
  const now = Date.now();
  const row = { id: sharedContentId(key), ...key, ...data, createdAt: now, updatedAt: now };
  yield* overlay.insert(db, target, sharedContents, row);
});

/**
 * Where a block's content, settings and items live, as a scope reads them: its synced
 * definition's shared content, or the block itself.
 */
export const contentOwnerOf = Effect.fn("contentOwnerOf")(function* (
  db: Database,
  scope: DraftScope,
  block: { id: string; projectId: number; type: string },
) {
  const key = definitionOf(block);
  const shared = yield* findSharedContent(db, scope, key);
  const root: ItemRoot = shared ? { sharedContent: key } : { blockId: block.id };
  return { shared: shared ?? null, root };
});

/** The placements of a definition as a scope reads them, oldest first. */
export const placementsOf = Effect.fn("placementsOf")(function* (
  db: Database,
  scope: DraftScope,
  key: DefinitionKey,
) {
  const rows = yield* overlay.select(db, scope, blocks, placementsWhere(key));
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
});

/**
 * Blocks and items as a scope's readers see them. A placement of a synced definition shows the
 * shared content, settings and summary, and the shared items, each named under the placement's
 * `blockId`: shared items keep their ids, so several placements read the same item ids. Each
 * block and item carries its summary, a generated value the scope reads (ADR 0012).
 */
export const withSharedContent = Effect.fn("withSharedContent")(function* <B extends BlockRow>(
  db: Database,
  scope: DraftScope,
  blockRows: readonly B[],
  itemRows: readonly ItemRow[],
) {
  const shown = yield* sharedContentShown(db, scope, blockRows, itemRows);
  const summaries = yield* readValuesOf(db, scope, "summary", {
    block: shown.blocks.filter((block) => !block.sharedContentId).map((block) => block.id),
    sharedContent: shown.blocks.flatMap((block) =>
      block.sharedContentId ? [block.sharedContentId] : [],
    ),
    repeatableItem: shown.items.map((item) => item.id),
  });
  const summaryOf = (entity: GeneratedEntity, id: string) =>
    summaries.get(entity)?.get(id)?.value?.summary ?? "";
  return {
    blocks: shown.blocks.map(({ sharedContentId: shared, ...block }) => ({
      ...block,
      summary: shared ? summaryOf("sharedContent", shared) : summaryOf("block", block.id),
    })),
    items: shown.items.map((item) => ({ ...item, summary: summaryOf("repeatableItem", item.id) })),
  };
});

const sharedContentShown = Effect.fn("sharedContentShown")(function* <B extends BlockRow>(
  db: Database,
  scope: DraftScope,
  blockRows: readonly B[],
  itemRows: readonly ItemRow[],
) {
  const projectIds = [...new Set(blockRows.map((block) => block.projectId))];
  const types = [...new Set(blockRows.map((block) => block.type))];
  const ownItems = (items: readonly ItemRow[]) =>
    items.filter((item): item is ItemRow & { blockId: string } => item.blockId !== null);
  const unshared = (rows: readonly B[]) =>
    rows.map((block) => ({ ...block, sharedContentId: null as string | null }));
  if (blockRows.length === 0) return { blocks: unshared(blockRows), items: ownItems(itemRows) };

  const shared = yield* overlay.select(
    db,
    scope,
    sharedContents,
    and(inArray(sharedContents.projectId, projectIds), inArray(sharedContents.type, types)),
  );
  if (shared.length === 0) return { blocks: unshared(blockRows), items: ownItems(itemRows) };
  const keyOf = ({ projectId, type }: DefinitionKey) => `${projectId}:${type}`;
  const sharedByKey = new Map(shared.map((row) => [keyOf(row), row]));
  const sharedItems = yield* overlay.select(
    db,
    scope,
    repeatableItems,
    and(
      inArray(repeatableItems.projectId, projectIds),
      inArray(
        repeatableItems.sharedContentType,
        shared.map((row) => row.type),
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
    if (!content) return { ...block, sharedContentId: null as string | null };
    placed.add(block.id);
    return {
      ...block,
      content: content.content,
      settings: content.settings,
      sharedContentId: content.id as string | null,
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

/** Invalidates every read showing a definition's shared content, in the scope it changed in. */
export function broadcastSharedContentChange(
  ctx: ServiceContext,
  scope: DraftScope,
  projectId: number,
  type: string,
) {
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope?.id ?? null,
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

/** A placement holding nothing of its own: its content lives in the shared content. */
const clearedPlacement = { content: {}, settings: null };

type ItemValues = Pick<
  typeof repeatableItems.$inferInsert,
  "parentItemId" | "fieldName" | "content" | "settings" | "position"
>;

/** Creates an item with a fresh id in a write target. Returns its id. */
const insertItem = Effect.fn("insertItem")(function* (
  db: Database,
  target: WriteTarget,
  root: ItemRoot,
  values: ItemValues,
  now: number,
) {
  const row = { ...values, ...rootColumns(root), createdAt: now, updatedAt: now };
  const inserted = yield* overlay.insert(db, target, repeatableItems, row);
  return inserted!.id;
});

/** Copies an item tree under another root in a target with fresh ids, parents before children. */
const copyItemTree = Effect.fn("copyItemTree")(function* (
  db: Database,
  target: WriteTarget,
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
        const copiedId = yield* insertItem(
          db,
          target,
          root,
          {
            parentItemId: copiedParentId,
            fieldName: item.fieldName,
            content: item.content,
            settings: item.settings,
            position: item.position,
          },
          now,
        );
        yield* copyChildren(item.id, copiedId);
      }
    });
  yield* copyChildren(null, null);
});

/** The content a definition's defaults give a new block, with its repeatable item seeds. */
const defaultBundle = Effect.fn("defaultBundle")(function* (
  db: Database,
  scope: DraftScope,
  key: DefinitionKey,
) {
  const definition = yield* findDefinition(db, key, scope);
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

/** Shared content from the definition's defaults, with their repeatable items, in a target. */
const sharedContentFromDefaults = Effect.fn("sharedContentFromDefaults")(function* (
  db: Database,
  target: WriteTarget,
  key: DefinitionKey,
) {
  const now = Date.now();
  const defaults = yield* defaultBundle(db, readScopeOf(target), key);
  yield* insertSharedContent(db, target, key, {
    content: defaults.content,
    settings: defaults.settings ?? null,
  });
  const ids = new Map<string, string>();
  for (const seed of defaults.seeds) {
    const id = yield* insertItem(
      db,
      target,
      { sharedContent: key },
      {
        parentItemId: seed.parentTempId ? (ids.get(seed.parentTempId) ?? null) : null,
        fieldName: seed.fieldName,
        content: seed.content,
        settings: seed.settings ?? null,
        position: seed.position,
      },
      now,
    );
    ids.set(seed.tempId, id);
  }
});

/** The items of a placement as a scope reads them. */
const itemsOfPlacements = (db: Database, scope: DraftScope, placementIds: string[]) =>
  overlay.select(db, scope, repeatableItems, inArray(repeatableItems.blockId, placementIds));

/**
 * Shared content taken from a placement, as a target reads it: its content, and its items, which
 * keep their ids. On Live, moving items under the shared content is a change drafts that copied
 * them see; in a draft, the items moved are draft rows.
 */
const sharedContentFromPlacement = Effect.fn("sharedContentFromPlacement")(function* (
  db: Database,
  target: WriteTarget,
  placement: BlockRow,
) {
  const key = definitionOf(placement);
  const { content, settings } = placement;
  yield* insertSharedContent(db, target, key, { content, settings });
  const moved = rootColumns({ sharedContent: key });
  for (const item of yield* itemsOfPlacements(db, readScopeOf(target), [placement.id])) {
    yield* overlay.update(db, target, repeatableItems, item.id, moved);
  }
});

/** Deletes items as a target reads them: Live's rows, or a draft's tombstones. */
const removeItems = Effect.fn("removeItems")(function* (
  db: Database,
  target: WriteTarget,
  items: readonly ItemRow[],
) {
  for (const item of items) yield* overlay.remove(db, target, repeatableItems, item.id);
});

/**
 * Becoming synced (ADR 0007), in the scope whose definitions changed: Live for a release, a
 * development draft for dev mode. The shared content is taken from the most recently published
 * placement, items included, or from the definition's defaults when there is none. Every
 * placement's own content is cleared. On Live that is a change drafts that copied a placement
 * see as a conflict; in a draft it writes draft rows.
 */
const becomeSynced = Effect.fn("becomeSynced")(function* (
  db: Database,
  target: WriteTarget,
  key: DefinitionKey,
) {
  const scope = readScopeOf(target);
  const placements = yield* placementsOf(db, scope, key);
  if (placements.length === 0) return yield* sharedContentFromDefaults(db, target, key);

  const placementIds = placements.map((block) => block.id);
  const items = yield* itemsOfPlacements(db, scope, placementIds);
  const lastItemUpdate = new Map<string, number>();
  const lastItemPublish = new Map<string, number>();
  for (const item of items) {
    const blockId = item.blockId!;
    lastItemUpdate.set(blockId, Math.max(lastItemUpdate.get(blockId) ?? 0, item.updatedAt));
    if (item.publishedAt == null) continue;
    lastItemPublish.set(blockId, Math.max(lastItemPublish.get(blockId) ?? 0, item.publishedAt));
  }
  const lastUpdate = (block: BlockRow) =>
    Math.max(block.updatedAt, lastItemUpdate.get(block.id) ?? 0);
  // A placement was last published with its block or with one of its items.
  const lastPublish = (block: BlockRow) =>
    Math.max(block.publishedAt ?? -1, lastItemPublish.get(block.id) ?? -1);
  // Placements never published, or published together, go by their last update. Remaining ties
  // go to the newest placement, whose UUIDv7 sorts last.
  const rank = (block: BlockRow) => [lastPublish(block), lastUpdate(block)];
  const later = (a: BlockRow, b: BlockRow) => {
    const [aPublished, aUpdated] = rank(a);
    const [bPublished, bUpdated] = rank(b);
    if (aPublished !== bPublished) return aPublished > bPublished;
    return aUpdated >= bUpdated;
  };
  const latest = placements.reduce((best, block) => (later(block, best) ? block : best));
  yield* sharedContentFromPlacement(db, target, latest);
  yield* removeItems(
    db,
    target,
    items.filter((item) => item.blockId !== latest.id),
  );
  for (const placement of placements) {
    yield* overlay.update(db, target, blocks, placement.id, clearedPlacement);
  }
});

/**
 * No longer synced (ADR 0007), in the scope whose definitions changed: every placement gets its
 * own copy of the shared content, with fresh ids for the copied repeatable items, and the shared
 * content is deleted. On Live, drafts that copied a placement see the change as a conflict; in a
 * draft it writes draft rows and tombstones.
 */
const stopBeingSynced = Effect.fn("stopBeingSynced")(function* (
  db: Database,
  target: WriteTarget,
  shared: SharedContentRow,
) {
  const now = Date.now();
  const scope = readScopeOf(target);
  const key = definitionOf(shared);
  const root: ItemRoot = { sharedContent: key };
  const items = yield* overlay.select(db, scope, repeatableItems, itemsUnder(root));
  for (const placement of yield* placementsOf(db, scope, key)) {
    const copied = { content: shared.content, settings: shared.settings };
    yield* overlay.update(db, target, blocks, placement.id, copied);
    yield* copyItemTree(db, target, items, { blockId: placement.id }, now);
  }
  yield* removeItems(db, target, items);
  yield* overlay.remove(db, target, sharedContents, shared.id);
});

/**
 * Brings a definition's shared content in line with its synced flag, in the scope whose
 * definitions changed: a synced definition without shared content becomes synced, and shared
 * content of a definition that isn't synced is copied back into its placements.
 */
const alignSharedContent = Effect.fn("alignSharedContent")(function* (
  ctx: ServiceContext,
  { target, projectId, key, synced, seedFromDefaults }: SyncedFlag & { seedFromDefaults: boolean },
) {
  const scope = readScopeOf(target);
  const shared = yield* findSharedContent(ctx.db, scope, key);
  if (shared && !synced) yield* stopBeingSynced(ctx.db, target, shared);
  if (!shared && synced) {
    const placed = (yield* placementsOf(ctx.db, scope, key)).length > 0;
    if (placed || seedFromDefaults) yield* becomeSynced(ctx.db, target, key);
  }
  broadcastSharedContentChange(ctx, scope, projectId, key.type);
});

/**
 * A definition's synced flag, in the target whose definitions a sync writes: Live for a release,
 * a development draft for dev mode (ADR 0006).
 */
type SyncedFlag = { target: WriteTarget; projectId: number; key: DefinitionKey; synced: boolean };

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
 * Makes a new placement, written to `target`, show its definition's shared content as that
 * target reads it. The placement's own content seeds the shared content when a synced definition
 * has none yet, and is dropped otherwise.
 */
export const adoptSharedContent = Effect.fn("blocks.adoptSharedContent")(function* (
  ctx: ServiceContext,
  target: WriteTarget,
  block: BlockRow,
) {
  const scope = readScopeOf(target);
  const key = definitionOf(block);
  const clear = overlay.update(ctx.db, target, blocks, block.id, clearedPlacement);
  if (yield* findSharedContent(ctx.db, scope, key)) {
    yield* removeItems(ctx.db, target, yield* itemsOfPlacements(ctx.db, scope, [block.id]));
    return void (yield* clear);
  }
  if (!(yield* findDefinition(ctx.db, key, scope))?.synced) return;
  yield* sharedContentFromPlacement(ctx.db, target, block);
  yield* clear;
});

/**
 * A placement through which a synced definition's shared content reads in a scope. Nothing when
 * the definition isn't synced or isn't placed.
 */
export const sharedPlacementId = Effect.fn("blocks.sharedPlacementId")(function* (
  db: Database,
  scope: DraftScope,
  key: DefinitionKey,
) {
  if (!(yield* findSharedContent(db, scope, key))) return null;
  const [first] = yield* placementsOf(db, scope, key);
  return first?.id ?? null;
});
