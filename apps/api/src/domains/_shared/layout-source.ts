import { eq } from "drizzle-orm";

import { layoutCheckpoints, type layouts } from "../../schema";
import { resolveSyncedLiveData } from "../blocks/synced-live";
import type { ServiceContext } from "./service-context";
import { layoutSnapshotSchema, type LayoutSnapshot } from "./snapshot-schemas";

/** Layouts always resolve their own live pointer, independently of page publication. */
export async function readLayoutSnapshot(
  ctx: ServiceContext,
  layoutRow: typeof layouts.$inferSelect,
): Promise<LayoutSnapshot | null> {
  if (layoutRow.livePublishedCheckpointId == null) return null;
  const checkpoint = await ctx.db
    .select()
    .from(layoutCheckpoints)
    .where(eq(layoutCheckpoints.id, layoutRow.livePublishedCheckpointId))
    .get();
  if (!checkpoint) return null;
  return resolveSyncedLiveData(
    ctx,
    layoutRow.environmentId,
    layoutSnapshotSchema.parse(JSON.parse(checkpoint.snapshot)),
  );
}
