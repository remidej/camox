import { and, eq, inArray } from "drizzle-orm";

import { blockDefinitions, layoutCheckpoints, layouts, pageCheckpoints, pages } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import {
  layoutSnapshotSchema,
  pageSnapshotSchema,
  type SnapshotBlock,
  type SnapshotRepeatableItem,
} from "../_shared/snapshot-schemas";

type ContentSnapshot = { blocks: SnapshotBlock[]; repeatableItems: SnapshotRepeatableItem[] };

/** Publish shared data independently of placement lifetime and immutable history. */
export async function publishSyncedData(
  ctx: ServiceContext,
  environmentId: number,
  snapshot: ContentSnapshot,
) {
  const seen = new Set<string>();
  for (const block of snapshot.blocks) {
    if (seen.has(block.type)) continue;
    seen.add(block.type);
    await ctx.db
      .update(blockDefinitions)
      .set({
        syncedPublishedData: {
          block,
          items: snapshot.repeatableItems.filter((item) => item.blockId === block.id),
        },
      })
      .where(
        and(
          eq(blockDefinitions.environmentId, environmentId),
          eq(blockDefinitions.blockId, block.type),
          eq(blockDefinitions.synced, true),
        ),
      );
  }
}

/** When opting an existing type in, seed live data from its latest publication, not its draft. */
export async function initializeSyncedLiveData(
  ctx: ServiceContext,
  environmentId: number,
  type: string,
) {
  const pageRows = await ctx.db
    .select({ checkpoint: pageCheckpoints })
    .from(pageCheckpoints)
    .innerJoin(pages, eq(pages.livePublishedCheckpointId, pageCheckpoints.id))
    .where(eq(pages.environmentId, environmentId));
  const layoutRows = await ctx.db
    .select({ checkpoint: layoutCheckpoints })
    .from(layoutCheckpoints)
    .innerJoin(layouts, eq(layouts.livePublishedCheckpointId, layoutCheckpoints.id))
    .where(eq(layouts.environmentId, environmentId));
  const candidates = [
    ...pageRows.map(({ checkpoint }) => ({
      createdAt: checkpoint.createdAt,
      snapshot: pageSnapshotSchema.parse(JSON.parse(checkpoint.snapshot)),
    })),
    ...layoutRows.map(({ checkpoint }) => ({
      createdAt: checkpoint.createdAt,
      snapshot: layoutSnapshotSchema.parse(JSON.parse(checkpoint.snapshot)),
    })),
  ].sort((a, b) => b.createdAt - a.createdAt);
  for (const candidate of candidates) {
    const block = candidate.snapshot.blocks.find((block) => block.type === type);
    if (!block) continue;
    await publishSyncedData(ctx, environmentId, {
      blocks: [block],
      repeatableItems: candidate.snapshot.repeatableItems,
    });
    return;
  }
}

/** Live reads share the latest published value; explicit history reads bypass this. */
export async function resolveSyncedLiveData<T extends ContentSnapshot>(
  ctx: ServiceContext,
  environmentId: number,
  snapshot: T,
): Promise<T> {
  const types = [...new Set(snapshot.blocks.map((block) => block.type))];
  if (types.length === 0) return snapshot;
  const definitions = await ctx.db
    .select({ type: blockDefinitions.blockId, data: blockDefinitions.syncedPublishedData })
    .from(blockDefinitions)
    .where(
      and(
        eq(blockDefinitions.environmentId, environmentId),
        eq(blockDefinitions.synced, true),
        inArray(blockDefinitions.blockId, types),
      ),
    );
  const sharedByType = new Map(definitions.map((definition) => [definition.type, definition.data]));
  if (sharedByType.size === 0) return snapshot;

  const repeatableItems: SnapshotRepeatableItem[] = [];
  const resolved = snapshot.blocks.map((placement) => {
    const shared = sharedByType.get(placement.type);
    if (!shared) {
      repeatableItems.push(
        ...snapshot.repeatableItems.filter((item) => item.blockId === placement.id),
      );
      return placement;
    }
    repeatableItems.push(...shared.items.map((item) => ({ ...item, blockId: placement.id })));
    return {
      ...placement,
      content: shared.block.content,
      settings: shared.block.settings,
      summary: shared.block.summary,
    };
  });
  return { ...snapshot, blocks: resolved, repeatableItems };
}
