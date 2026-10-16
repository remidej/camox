import { queryKeys } from "@camox/api-contract/query-keys";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { bumpContentUpdatedAtForBlocks } from "../../lib/bump-content-updated-at";
import { blocks, repeatableItems, sharedContentId, sharedContents } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { readValues } from "../generated-values/service";
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
  scope: DraftScope,
  key: DefinitionKey,
  data: { content: unknown; settings: unknown },
) {
  const now = Date.now();
  const row = { id: sharedContentId(key), ...key, ...data, createdAt: now, updatedAt: now };
  if (scope) return void (yield* overlay.insert(db, scope, sharedContents, row));
  // Only releases and Live writes create Live's shared content.
  yield* Effect.promise(() =>
    db
      .insert(sharedContents)
      .values({ ...row, ...overlay.releasedNew(now) })
      .onConflictDoNothing(),
  );
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
  const blockSummaries = yield* readValues(
    db,
    scope,
    "block",
    "summary",
    shown.blocks.filter((block) => !block.sharedContentId).map((block) => block.id),
  );
  const sharedSummaries = yield* readValues(
    db,
    scope,
    "sharedContent",
    "summary",
    shown.blocks.flatMap((block) => (block.sharedContentId ? [block.sharedContentId] : [])),
  );
  const itemSummaries = yield* readValues(
    db,
    scope,
    "repeatableItem",
    "summary",
    shown.items.map((item) => item.id),
  );
  return {
    blocks: shown.blocks.map(({ sharedContentId: shared, ...block }) => ({
      ...block,
      summary:
        (shared ? sharedSummaries.get(shared) : blockSummaries.get(block.id))?.value?.summary ?? "",
    })),
    items: shown.items.map((item) => ({
      ...item,
      summary: itemSummaries.get(item.id)?.value?.summary ?? "",
    })),
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

/** A block as a scope's readers see it. */
export const shownBlock = Effect.fn("shownBlock")(function* <B extends BlockRow>(
  db: Database,
  scope: DraftScope,
  block: B,
) {
  return (yield* withSharedContent(db, scope, [block], [])).blocks[0];
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

/**
 * Bumps the Live pages and layouts placing a definition, whose content changed with its Live
 * shared content.
 */
export const bumpPlacementOwners = Effect.fn("bumpPlacementOwners")(function* (
  db: Database,
  key: DefinitionKey,
) {
  const placements = yield* placementsOf(db, null, key);
  yield* bumpContentUpdatedAtForBlocks(
    db,
    placements.map((block) => block.id),
  );
});

/** A placement holding nothing of its own: its content lives in the shared content. */
const clearedPlacement = { content: {}, settings: null };

type ItemValues = Pick<
  typeof repeatableItems.$inferInsert,
  "parentItemId" | "fieldName" | "content" | "settings" | "position"
>;

/**
 * Creates an item in a scope: on Live as a release does, stamped as released; in a draft as a
 * draft row. Returns its id.
 */
const insertItem = Effect.fn("insertItem")(function* (
  db: Database,
  scope: DraftScope,
  root: ItemRoot,
  values: ItemValues,
  now: number,
) {
  const row = { ...values, ...rootColumns(root), createdAt: now, updatedAt: now };
  if (scope) {
    const inserted = yield* overlay.insert(db, scope, repeatableItems, row);
    return inserted!.id;
  }
  const inserted = yield* Effect.promise(() =>
    db
      .insert(repeatableItems)
      .values({ ...row, ...overlay.releasedNew(now) })
      .returning({ id: repeatableItems.id })
      .get(),
  );
  return inserted.id;
});

/** Copies an item tree under another root in a scope with fresh ids, parents before children. */
const copyItemTree = Effect.fn("copyItemTree")(function* (
  db: Database,
  scope: DraftScope,
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
          scope,
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

/** Shared content from the definition's defaults, with their repeatable items, in a scope. */
const sharedContentFromDefaults = Effect.fn("sharedContentFromDefaults")(function* (
  db: Database,
  scope: DraftScope,
  key: DefinitionKey,
) {
  const now = Date.now();
  const defaults = yield* defaultBundle(db, scope, key);
  yield* insertSharedContent(db, scope, key, {
    content: defaults.content,
    settings: defaults.settings ?? null,
  });
  const ids = new Map<string, string>();
  for (const seed of defaults.seeds) {
    const id = yield* insertItem(
      db,
      scope,
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
 * Shared content taken from a placement, as a scope reads it: its content, and its items, which
 * keep their ids. On Live, moving items under the shared content is a change drafts that copied
 * them see; in a draft, the items moved are draft rows.
 */
const sharedContentFromPlacement = Effect.fn("sharedContentFromPlacement")(function* (
  db: Database,
  scope: DraftScope,
  placement: BlockRow,
) {
  const key = definitionOf(placement);
  const { content, settings } = placement;
  yield* insertSharedContent(db, scope, key, { content, settings });
  const moved = rootColumns({ sharedContent: key });
  if (scope) {
    for (const item of yield* itemsOfPlacements(db, scope, [placement.id])) {
      yield* overlay.update(db, scope, repeatableItems, item.id, moved);
    }
    return;
  }
  yield* Effect.promise(() =>
    db
      .update(repeatableItems)
      .set({ ...moved, ...overlay.releasedChange(repeatableItems, Date.now()) })
      .where(
        and(eq(repeatableItems.blockId, placement.id), overlay.storedIn(repeatableItems, null)),
      ),
  );
});

/** Deletes items as a scope reads them: Live's rows, or a draft's tombstones. */
const removeItems = Effect.fn("removeItems")(function* (
  db: Database,
  scope: DraftScope,
  items: readonly ItemRow[],
) {
  if (items.length === 0) return;
  if (!scope) {
    yield* Effect.promise(() =>
      db.delete(repeatableItems).where(
        and(
          inArray(
            repeatableItems.id,
            items.map((item) => item.id),
          ),
          overlay.storedIn(repeatableItems, null),
        ),
      ),
    );
    return;
  }
  for (const item of items) yield* overlay.remove(db, scope, repeatableItems, item.id);
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
  scope: DraftScope,
  key: DefinitionKey,
) {
  const placements = yield* placementsOf(db, scope, key);
  if (placements.length === 0) return yield* sharedContentFromDefaults(db, scope, key);

  const placementIds = placements.map((block) => block.id);
  const items = yield* itemsOfPlacements(db, scope, placementIds);
  const lastItemUpdate = new Map<string, number>();
  for (const item of items) {
    const blockId = item.blockId!;
    lastItemUpdate.set(blockId, Math.max(lastItemUpdate.get(blockId) ?? 0, item.updatedAt));
  }
  const lastUpdate = (block: BlockRow) =>
    Math.max(block.updatedAt, lastItemUpdate.get(block.id) ?? 0);
  // Placements never published, or published together, go by their last update. Remaining ties
  // go to the newest placement, whose UUIDv7 sorts last.
  const rank = (block: BlockRow) => [block.publishedAt ?? -1, lastUpdate(block)];
  const later = (a: BlockRow, b: BlockRow) => {
    const [aPublished, aUpdated] = rank(a);
    const [bPublished, bUpdated] = rank(b);
    if (aPublished !== bPublished) return aPublished > bPublished;
    return aUpdated >= bUpdated;
  };
  const latest = placements.reduce((best, block) => (later(block, best) ? block : best));
  yield* sharedContentFromPlacement(db, scope, latest);
  yield* removeItems(
    db,
    scope,
    items.filter((item) => item.blockId !== latest.id),
  );
  if (scope) {
    for (const placement of placements) {
      yield* overlay.update(db, scope, blocks, placement.id, clearedPlacement);
    }
    return;
  }
  yield* Effect.promise(() =>
    db
      .update(blocks)
      .set({ ...clearedPlacement, ...overlay.releasedChange(blocks, Date.now()) })
      .where(and(placementsWhere(key), overlay.storedIn(blocks, null))),
  );
});

/**
 * No longer synced (ADR 0007), in the scope whose definitions changed: every placement gets its
 * own copy of the shared content, with fresh ids for the copied repeatable items, and the shared
 * content is deleted. On Live, drafts that copied a placement see the change as a conflict; in a
 * draft it writes draft rows and tombstones.
 */
const stopBeingSynced = Effect.fn("stopBeingSynced")(function* (
  db: Database,
  scope: DraftScope,
  shared: SharedContentRow,
) {
  const now = Date.now();
  const key = definitionOf(shared);
  const root: ItemRoot = { sharedContent: key };
  const items = yield* overlay.select(db, scope, repeatableItems, itemsUnder(root));
  for (const placement of yield* placementsOf(db, scope, key)) {
    const copied = { content: shared.content, settings: shared.settings };
    if (scope) {
      yield* overlay.update(db, scope, blocks, placement.id, copied);
    } else {
      yield* Effect.promise(() =>
        db
          .update(blocks)
          .set({ ...copied, ...overlay.releasedChange(blocks, now) })
          .where(eq(blocks.rowId, placement.rowId)),
      );
    }
    yield* copyItemTree(db, scope, items, { blockId: placement.id }, now);
  }
  yield* removeItems(db, scope, items);
  if (scope) {
    yield* overlay.remove(db, scope, sharedContents, shared.id);
    return;
  }
  yield* Effect.promise(() =>
    db
      .delete(sharedContents)
      .where(and(eq(sharedContents.id, shared.id), overlay.storedIn(sharedContents, null))),
  );
});

/**
 * Brings a definition's shared content in line with its synced flag, in the scope whose
 * definitions changed: a synced definition without shared content becomes synced, and shared
 * content of a definition that isn't synced is copied back into its placements.
 */
const alignSharedContent = Effect.fn("alignSharedContent")(function* (
  ctx: ServiceContext,
  { scope, projectId, key, synced, seedFromDefaults }: SyncedFlag & { seedFromDefaults: boolean },
) {
  const shared = yield* findSharedContent(ctx.db, scope, key);
  if (shared && !synced) yield* stopBeingSynced(ctx.db, scope, shared);
  if (!shared && synced) {
    const placed = (yield* placementsOf(ctx.db, scope, key)).length > 0;
    if (placed || seedFromDefaults) yield* becomeSynced(ctx.db, scope, key);
  }
  if (!scope) yield* bumpPlacementOwners(ctx.db, key);
  broadcastSharedContentChange(ctx, scope, projectId, key.type);
});

/**
 * A definition's synced flag, in the scope whose definitions a sync writes: Live for a release,
 * a development draft for dev mode (ADR 0006).
 */
type SyncedFlag = { scope: DraftScope; projectId: number; key: DefinitionKey; synced: boolean };

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
 * Makes a new placement, stored in `scope`, show its definition's shared content as that scope
 * reads it. The placement's own content seeds the shared content when a synced definition has
 * none yet, and is dropped otherwise.
 */
export const adoptSharedContent = Effect.fn("blocks.adoptSharedContent")(function* (
  ctx: ServiceContext,
  scope: DraftScope,
  block: BlockRow,
) {
  const key = definitionOf(block);
  // The new row itself, whether in Live or in a draft.
  const clear = Effect.promise(() =>
    ctx.db.update(blocks).set(clearedPlacement).where(eq(blocks.rowId, block.rowId)),
  );
  if (yield* findSharedContent(ctx.db, scope, key)) {
    yield* Effect.promise(() =>
      ctx.db
        .delete(repeatableItems)
        .where(
          and(eq(repeatableItems.blockId, block.id), overlay.storedIn(repeatableItems, scope)),
        ),
    );
    return yield* clear;
  }
  if (!(yield* findDefinition(ctx.db, key, scope))?.synced) return;
  yield* sharedContentFromPlacement(ctx.db, scope, block);
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
