import { queryKeys } from "@camox/api-contract/query-keys";
import { and, eq, inArray, or } from "drizzle-orm";
import { Effect } from "effect";

import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { bumpContentUpdatedAtForBlocks } from "../../lib/bump-content-updated-at";
import { blockDefinitions, blocks, layouts, pages, repeatableItems } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { initializeSyncedLiveData } from "./synced-live";

/** Placements keep their own identity/order; only data is shared, within an environment. */
const instances = Effect.fn("instances")(function* (
  ctx: ServiceContext,
  environmentId: number,
  type: string,
) {
  return yield* Effect.promise(() =>
    ctx.db
      .select({ block: blocks })
      .from(blocks)
      .leftJoin(pages, eq(blocks.pageId, pages.id))
      .leftJoin(layouts, eq(blocks.layoutId, layouts.id))
      .where(
        and(
          eq(blocks.type, type),
          or(eq(pages.environmentId, environmentId), eq(layouts.environmentId, environmentId)),
        ),
      )
      .orderBy(blocks.id),
  );
});

const copyItems = Effect.fn("copyItems")(function* (
  ctx: ServiceContext,
  source: typeof blocks.$inferSelect,
  target: typeof blocks.$inferSelect,
) {
  const sourceItems = yield* Effect.promise(() =>
    ctx.db.select().from(repeatableItems).where(eq(repeatableItems.blockId, source.id)),
  );
  const targetItems = yield* Effect.promise(() =>
    ctx.db.select().from(repeatableItems).where(eq(repeatableItems.blockId, target.id)),
  );
  const byKey = new Map(
    targetItems.filter((item) => item.syncKey).map((item) => [item.syncKey!, item]),
  );
  const kept = new Set<number>();

  // Walk the tree rather than relying on row/position order: child IDs may be
  // smaller than parent IDs after a checkpoint restore or environment copy.
  const copyChildren = (
    parentId: number | null,
    targetParentId: number | null,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      for (const item of sourceItems.filter((item) => item.parentItemId === parentId)) {
        const syncKey = item.syncKey ?? crypto.randomUUID();
        if (!item.syncKey) {
          yield* Effect.promise(() =>
            ctx.db.update(repeatableItems).set({ syncKey }).where(eq(repeatableItems.id, item.id)),
          );
        }
        const { id: _id, blockId: _blockId, ...data } = item;
        const values = { ...data, syncKey, blockId: target.id, parentItemId: targetParentId };
        const existing = byKey.get(syncKey);
        const copied = yield* Effect.promise(() =>
          existing
            ? ctx.db
                .update(repeatableItems)
                .set(values)
                .where(eq(repeatableItems.id, existing.id))
                .returning()
                .get()
            : ctx.db.insert(repeatableItems).values(values).returning().get(),
        );
        kept.add(copied.id);
        yield* copyChildren(item.id, copied.id);
      }
    });
  yield* copyChildren(null, null);
  for (const item of targetItems) {
    if (kept.has(item.id)) continue;
    yield* Effect.promise(() =>
      ctx.db.delete(repeatableItems).where(eq(repeatableItems.id, item.id)),
    );
  }
});

/** Enable syncing deterministically: the oldest existing instance wins. */
export const reconcileSyncedDefinition = Effect.fn("blocks.reconcileSyncedDefinition")(function* (
  ctx: ServiceContext,
  environmentId: number,
  type: string,
) {
  yield* initializeSyncedLiveData(ctx, environmentId, type);
  const rows = yield* instances(ctx, environmentId, type);
  if (rows.length < 2) return;
  yield* syncBlockData(ctx, rows[0].block.id);
});

/**
 * Fan out a data edit, or seed a newly created placement from existing data.
 * This deliberately doesn't copy page/layout IDs, placement or block position.
 * Published checkpoints remain immutable; edits still require publishing.
 */
export const syncBlockData = Effect.fn("blocks.syncBlockData")(function* (
  ctx: ServiceContext,
  blockId: number,
  initialize = false,
) {
  const row = yield* Effect.promise(() =>
    ctx.db
      .select({ block: blocks, page: pages, layout: layouts })
      .from(blocks)
      .leftJoin(pages, eq(blocks.pageId, pages.id))
      .leftJoin(layouts, eq(blocks.layoutId, layouts.id))
      .where(eq(blocks.id, blockId))
      .get(),
  );
  const owner = row?.page ?? row?.layout;
  if (!row || !owner) return;
  const definition = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.environmentId, owner.environmentId),
          eq(blockDefinitions.blockId, row.block.type),
        ),
      )
      .get(),
  );
  if (!definition?.synced) return;

  const peers = (yield* instances(ctx, owner.environmentId, row.block.type))
    .map(({ block }) => block)
    .filter((block) => block.id !== blockId);
  if (peers.length === 0) return;
  // Prefer another owner when restoring a page: its other restored placements
  // may still contain historical data until their turn in the restore loop.
  const existing =
    peers.find(
      (peer) => peer.pageId !== row.block.pageId || peer.layoutId !== row.block.layoutId,
    ) ?? peers[0];
  const source = initialize ? existing : row.block;
  const targets = initialize ? [row.block] : peers;
  for (const target of targets) yield* copyItems(ctx, source, target);
  // Commit block-level data to every placement in one statement, including the
  // source, so competing edits cannot leave different placements with different values.
  const ids = targets.map((block) => block.id);
  if (!initialize) ids.push(source.id);
  yield* Effect.promise(() =>
    ctx.db
      .update(blocks)
      .set({
        content: source.content,
        settings: source.settings,
        summary: source.summary,
        updatedAt: Date.now(),
      })
      .where(inArray(blocks.id, ids)),
  );
  yield* bumpContentUpdatedAtForBlocks(
    ctx.db,
    targets.map((block) => block.id),
  );
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: owner.projectId,
    targets: [
      queryKeys.pages.getByPathAll,
      queryKeys.pages.list,
      queryKeys.layouts.all,
      ["camox", "blocks", "getPageMarkdown"],
      ["camox", "repeatableItems", "get"],
      ...targets.map((block) => queryKeys.blocks.get(block.id, "draft")),
    ],
  });
});
