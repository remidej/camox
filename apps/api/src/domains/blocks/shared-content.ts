import { queryKeys, type QueryKey } from "@camox/api-contract/query-keys";
import { and, eq, inArray, max, type SQL } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { bumpContentUpdatedAtForBlocks } from "../../lib/bump-content-updated-at";
import { blockDefinitions, blocks, repeatableItems, sharedContents } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
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

/** The root of a repeatable item tree: a block, or a synced definition's shared content. */
export type ItemRoot = { blockId: string } | { environmentId: number; sharedContentType: string };

/** The items in the tree under a root. */
export function itemsUnder(root: ItemRoot): SQL {
  if ("blockId" in root) return eq(repeatableItems.blockId, root.blockId);
  return and(
    eq(repeatableItems.environmentId, root.environmentId),
    eq(repeatableItems.sharedContentType, root.sharedContentType),
  )!;
}

/** The columns placing an item in a root's tree. */
export function rootColumns(root: ItemRoot) {
  if ("blockId" in root) {
    return { blockId: root.blockId, environmentId: null, sharedContentType: null };
  }
  return {
    blockId: null,
    environmentId: root.environmentId,
    sharedContentType: root.sharedContentType,
  };
}

export function rootOfItem(item: Pick<ItemRow, "blockId" | "environmentId" | "sharedContentType">) {
  if (item.blockId !== null) return { blockId: item.blockId } satisfies ItemRoot;
  return {
    environmentId: item.environmentId!,
    sharedContentType: item.sharedContentType!,
  } satisfies ItemRoot;
}

function sharedRoot(environmentId: number, type: string): ItemRoot {
  return { environmentId, sharedContentType: type };
}

export const findSharedContent = Effect.fn("findSharedContent")(function* (
  db: Database,
  environmentId: number,
  type: string,
) {
  return yield* Effect.promise(() =>
    db
      .select()
      .from(sharedContents)
      .where(and(eq(sharedContents.environmentId, environmentId), eq(sharedContents.type, type)))
      .get(),
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
  const shared = yield* findSharedContent(db, block.environmentId, block.type);
  if (shared) {
    return { shared, root: sharedRoot(block.environmentId, block.type) } as const;
  }
  return { shared: null, root: { blockId: block.id } satisfies ItemRoot } as const;
});

/** The placements of a definition in an environment, oldest first. */
const placementsOf = Effect.fn("placementsOf")(function* (
  db: Database,
  environmentId: number,
  type: string,
) {
  return yield* Effect.promise(() =>
    db
      .select()
      .from(blocks)
      .where(and(eq(blocks.environmentId, environmentId), eq(blocks.type, type)))
      .orderBy(blocks.id),
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
  const key = (environmentId: number, type: string) => `${environmentId}:${type}`;
  const sharedByKey = new Map(shared.map((row) => [key(row.environmentId, row.type), row]));
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
    const itemKey = key(item.environmentId!, item.sharedContentType!);
    if (!sharedByKey.has(itemKey)) continue;
    itemsByKey.set(itemKey, [...(itemsByKey.get(itemKey) ?? []), item]);
  }

  const placed = new Set<string>();
  const projectedBlocks = blockRows.map((block) => {
    const content = sharedByKey.get(key(block.environmentId, block.type));
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
    for (const item of itemsByKey.get(key(block.environmentId, block.type)) ?? []) {
      items.push({ ...item, blockId: block.id });
    }
  }
  return { blocks: projectedBlocks, items };
});

/** Invalidates every read showing a definition's shared content. */
export function broadcastSharedContentChange(
  ctx: ServiceContext,
  projectId: number,
  type: string,
  targets: QueryKey[] = [],
) {
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
      ...targets,
    ],
  });
}

/** Bumps the pages and layouts placing a definition, whose content changed with its shared content. */
export const bumpPlacementOwners = Effect.fn("bumpPlacementOwners")(function* (
  db: Database,
  environmentId: number,
  type: string,
) {
  const placements = yield* placementsOf(db, environmentId, type);
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
const defaultBundle = Effect.fn("defaultBundle")(function* (
  definition: typeof blockDefinitions.$inferSelect | undefined,
) {
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

/**
 * Becoming synced (ADR 0007): the shared content is taken from the most recently updated
 * placement, items included, or from the definition's defaults when there is none. Every
 * placement's own content is cleared.
 */
const becomeSynced = Effect.fn("becomeSynced")(function* (
  ctx: ServiceContext,
  environmentId: number,
  type: string,
) {
  const now = Date.now();
  const root = sharedRoot(environmentId, type);
  const placements = yield* placementsOf(ctx.db, environmentId, type);
  const itemUpdates =
    placements.length > 0
      ? yield* Effect.promise(() =>
          ctx.db
            .select({ blockId: repeatableItems.blockId, updatedAt: max(repeatableItems.updatedAt) })
            .from(repeatableItems)
            .where(
              inArray(
                repeatableItems.blockId,
                placements.map((block) => block.id),
              ),
            )
            .groupBy(repeatableItems.blockId),
        )
      : [];
  const lastUpdate = (block: BlockRow) =>
    Math.max(block.updatedAt, itemUpdates.find((row) => row.blockId === block.id)?.updatedAt ?? 0);
  // Ties go to the newest placement, whose UUIDv7 sorts last.
  const latest = placements.reduce<BlockRow | undefined>(
    (best, block) => (!best || lastUpdate(block) >= lastUpdate(best) ? block : best),
    undefined,
  );

  if (latest) {
    yield* Effect.promise(() =>
      ctx.db.insert(sharedContents).values({
        environmentId,
        type,
        content: latest.content,
        settings: latest.settings,
        summary: latest.summary,
        createdAt: now,
        updatedAt: now,
      }),
    );
    yield* Effect.promise(() =>
      ctx.db
        .update(repeatableItems)
        .set(rootColumns(root))
        .where(eq(repeatableItems.blockId, latest.id)),
    );
    yield* Effect.promise(() =>
      ctx.db.delete(repeatableItems).where(
        inArray(
          repeatableItems.blockId,
          placements.map((block) => block.id),
        ),
      ),
    );
    yield* Effect.promise(() =>
      ctx.db
        .update(blocks)
        .set(clearedPlacement)
        .where(and(eq(blocks.environmentId, environmentId), eq(blocks.type, type))),
    );
    return;
  }

  const definition = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(eq(blockDefinitions.environmentId, environmentId), eq(blockDefinitions.blockId, type)),
      )
      .get(),
  );
  const defaults = yield* defaultBundle(definition);
  yield* Effect.promise(() =>
    ctx.db.insert(sharedContents).values({
      environmentId,
      type,
      content: defaults.content,
      settings: defaults.settings ?? null,
      summary: "",
      createdAt: now,
      updatedAt: now,
    }),
  );
  const ids = new Map<string, string>();
  for (const seed of defaults.seeds) {
    const inserted = yield* Effect.promise(() =>
      ctx.db
        .insert(repeatableItems)
        .values({
          ...rootColumns(root),
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

/**
 * No longer synced (ADR 0007): every placement gets its own copy of the shared content, with
 * fresh ids for the copied repeatable items, and the shared content is deleted.
 */
const stopBeingSynced = Effect.fn("stopBeingSynced")(function* (
  ctx: ServiceContext,
  shared: SharedContentRow,
) {
  const now = Date.now();
  const root = sharedRoot(shared.environmentId, shared.type);
  const items = yield* Effect.promise(() =>
    ctx.db.select().from(repeatableItems).where(itemsUnder(root)),
  );
  const placements = yield* placementsOf(ctx.db, shared.environmentId, shared.type);
  for (const placement of placements) {
    yield* Effect.promise(() =>
      ctx.db
        .update(blocks)
        .set({ content: shared.content, settings: shared.settings, summary: shared.summary })
        .where(eq(blocks.id, placement.id)),
    );
    yield* copyItemTree(ctx.db, items, { blockId: placement.id }, now);
  }
  yield* Effect.promise(() => ctx.db.delete(repeatableItems).where(itemsUnder(root)));
  yield* Effect.promise(() =>
    ctx.db
      .delete(sharedContents)
      .where(
        and(
          eq(sharedContents.environmentId, shared.environmentId),
          eq(sharedContents.type, shared.type),
        ),
      ),
  );
});

/**
 * Brings a definition's shared content in line with its synced flag after a definition sync
 * creates the definition or changes the flag: a synced definition without shared content
 * becomes synced, and shared content of a definition that isn't synced is copied back into its
 * placements. A new synced definition that isn't placed yet gets its shared content from its
 * first placement instead, like a layout declaring it.
 */
export const applySyncedFlag = Effect.fn("blocks.applySyncedFlag")(function* (
  ctx: ServiceContext,
  {
    projectId,
    environmentId,
    type,
    synced,
    created = false,
  }: { projectId: number; environmentId: number; type: string; synced: boolean; created?: boolean },
) {
  const shared = yield* findSharedContent(ctx.db, environmentId, type);
  const placed = (yield* placementsOf(ctx.db, environmentId, type)).length > 0;
  if (shared && !synced) yield* stopBeingSynced(ctx, shared);
  if (!shared && synced && (placed || !created)) yield* becomeSynced(ctx, environmentId, type);
  yield* bumpPlacementOwners(ctx.db, environmentId, type);
  broadcastSharedContentChange(ctx, projectId, type);
});

/**
 * Makes a new placement show its definition's shared content. The placement's own content seeds
 * the shared content when a synced definition has none yet, and is dropped otherwise.
 */
export const adoptSharedContent = Effect.fn("blocks.adoptSharedContent")(function* (
  ctx: ServiceContext,
  block: BlockRow,
) {
  const shared = yield* findSharedContent(ctx.db, block.environmentId, block.type);
  if (shared) {
    yield* Effect.promise(() =>
      ctx.db.delete(repeatableItems).where(eq(repeatableItems.blockId, block.id)),
    );
  } else {
    const definition = yield* Effect.promise(() =>
      ctx.db
        .select({ synced: blockDefinitions.synced })
        .from(blockDefinitions)
        .where(
          and(
            eq(blockDefinitions.environmentId, block.environmentId),
            eq(blockDefinitions.blockId, block.type),
          ),
        )
        .get(),
    );
    if (!definition?.synced) return;
    const now = Date.now();
    yield* Effect.promise(() =>
      ctx.db.insert(sharedContents).values({
        environmentId: block.environmentId,
        type: block.type,
        content: block.content,
        settings: block.settings,
        summary: block.summary,
        createdAt: now,
        updatedAt: now,
      }),
    );
    yield* Effect.promise(() =>
      ctx.db
        .update(repeatableItems)
        .set(rootColumns(sharedRoot(block.environmentId, block.type)))
        .where(eq(repeatableItems.blockId, block.id)),
    );
  }
  yield* Effect.promise(() =>
    ctx.db.update(blocks).set(clearedPlacement).where(eq(blocks.id, block.id)),
  );
});

/**
 * A placement through which a synced definition's shared content reads, in an environment.
 * Nothing when the definition isn't synced or isn't placed.
 */
export const sharedPlacementId = Effect.fn("blocks.sharedPlacementId")(function* (
  db: Database,
  environmentId: number,
  type: string,
) {
  if (!(yield* findSharedContent(db, environmentId, type))) return null;
  const [first] = yield* placementsOf(db, environmentId, type);
  return first?.id ?? null;
});
