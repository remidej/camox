import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../db";
import { blocks, layouts, pages } from "../schema";

/**
 * Bumps `content_updated_at` on the parent page or layout that owns these
 * blocks. Called by every block / repeatable-item mutation so the derived
 * publish status is a cheap timestamp compare instead of a row scan. One
 * extra UPDATE per mutation on the hot edit path.
 */
export const bumpContentUpdatedAt = Effect.fn("bumpContentUpdatedAt")(function* (
  db: Database,
  parent: { pageId?: number | null; layoutId?: number | null },
) {
  const now = Date.now();
  const { pageId, layoutId } = parent;
  if (pageId != null) {
    yield* Effect.promise(() =>
      db.update(pages).set({ contentUpdatedAt: now }).where(eq(pages.id, pageId)),
    );
    return;
  }
  if (layoutId != null) {
    yield* Effect.promise(() =>
      db.update(layouts).set({ contentUpdatedAt: now }).where(eq(layouts.id, layoutId)),
    );
  }
});

/** Looks up a single block's parent and bumps it. */
export const bumpContentUpdatedAtForBlock = Effect.fn("bumpContentUpdatedAtForBlock")(function* (
  db: Database,
  blockId: number,
) {
  const row = yield* Effect.promise(() =>
    db
      .select({ pageId: blocks.pageId, layoutId: blocks.layoutId })
      .from(blocks)
      .where(eq(blocks.id, blockId))
      .get(),
  );
  if (!row) return;
  yield* bumpContentUpdatedAt(db, row);
});

/** Variant for batch mutations — looks up parents for several block ids. */
export const bumpContentUpdatedAtForBlocks = Effect.fn("bumpContentUpdatedAtForBlocks")(function* (
  db: Database,
  blockIds: number[],
) {
  if (blockIds.length === 0) return;
  const rows = yield* Effect.promise(() =>
    db
      .select({ pageId: blocks.pageId, layoutId: blocks.layoutId })
      .from(blocks)
      .where(inArray(blocks.id, blockIds)),
  );
  const pageIds = new Set<number>();
  const layoutIds = new Set<number>();
  for (const row of rows) {
    if (row.pageId != null) pageIds.add(row.pageId);
    else if (row.layoutId != null) layoutIds.add(row.layoutId);
  }
  const now = Date.now();
  if (pageIds.size > 0) {
    yield* Effect.promise(() =>
      db
        .update(pages)
        .set({ contentUpdatedAt: now })
        .where(inArray(pages.id, [...pageIds])),
    );
  }
  if (layoutIds.size > 0) {
    yield* Effect.promise(() =>
      db
        .update(layouts)
        .set({ contentUpdatedAt: now })
        .where(inArray(layouts.id, [...layoutIds])),
    );
  }
});
