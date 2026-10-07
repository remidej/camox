import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { layoutCheckpoints, type layouts } from "../../schema";
import { resolveSyncedLiveData } from "../blocks/synced-live";
import type { ServiceContext } from "./service-context";
import { layoutSnapshotSchema, type LayoutSnapshot } from "./snapshot-schemas";

/** Layouts always resolve their own live pointer, independently of page publication. */
export const readLayoutSnapshot = Effect.fn("readLayoutSnapshot")(function* (
  ctx: ServiceContext,
  layoutRow: typeof layouts.$inferSelect,
): Effect.fn.Return<LayoutSnapshot | null> {
  const checkpointId = layoutRow.livePublishedCheckpointId;
  if (checkpointId == null) return null;
  const checkpoint = yield* Effect.promise(() =>
    ctx.db.select().from(layoutCheckpoints).where(eq(layoutCheckpoints.id, checkpointId)).get(),
  );
  if (!checkpoint) return null;
  return yield* resolveSyncedLiveData(
    ctx,
    layoutRow.environmentId,
    layoutSnapshotSchema.parse(JSON.parse(checkpoint.snapshot)),
  );
});
