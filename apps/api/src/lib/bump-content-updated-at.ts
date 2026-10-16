import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../db";
import { storedIn } from "../domains/drafts/overlay";
import { layoutNamed } from "../domains/layouts/identity";
import { blocks, layouts, pages } from "../schema";

/** A block's owner: a page, or a layout named within the block's project. */
type BlockParent = { projectId?: number; pageId?: string | null; layoutId?: string | null };

/**
 * Bumps `content_updated_at` on the Live parent page or layout that owns these
 * Live blocks. Called by every block / repeatable-item mutation, so readers can
 * tell when a page or layout's content last changed. One extra UPDATE per
 * mutation on the hot edit path.
 */
export const bumpContentUpdatedAt = Effect.fn("bumpContentUpdatedAt")(function* (
  db: Database,
  parent: BlockParent,
) {
  const now = Date.now();
  const { projectId, pageId, layoutId } = parent;
  if (pageId != null) {
    yield* Effect.promise(() =>
      db
        .update(pages)
        .set({ contentUpdatedAt: now })
        .where(and(eq(pages.id, pageId), storedIn(pages, null))),
    );
    return;
  }
  if (layoutId != null && projectId != null) {
    yield* Effect.promise(() =>
      db.update(layouts).set({ contentUpdatedAt: now }).where(layoutNamed(projectId, layoutId)),
    );
  }
});

/** Looks up a single block's parent and bumps it. */
export const bumpContentUpdatedAtForBlock = Effect.fn("bumpContentUpdatedAtForBlock")(function* (
  db: Database,
  blockId: string,
) {
  const row = yield* Effect.promise(() =>
    db
      .select({
        projectId: blocks.projectId,
        pageId: blocks.pageId,
        layoutId: blocks.layoutId,
      })
      .from(blocks)
      .where(and(eq(blocks.id, blockId), storedIn(blocks, null)))
      .get(),
  );
  if (!row) return;
  yield* bumpContentUpdatedAt(db, row);
});

/** Variant for batch mutations — looks up parents for several block ids. */
export const bumpContentUpdatedAtForBlocks = Effect.fn("bumpContentUpdatedAtForBlocks")(function* (
  db: Database,
  blockIds: string[],
) {
  if (blockIds.length === 0) return;
  const rows = yield* Effect.promise(() =>
    db
      .select({
        projectId: blocks.projectId,
        pageId: blocks.pageId,
        layoutId: blocks.layoutId,
      })
      .from(blocks)
      .where(and(inArray(blocks.id, blockIds), storedIn(blocks, null))),
  );
  const pageIds = new Set<string>();
  const layoutKeys = new Map<string, { projectId: number; layoutId: string }>();
  for (const row of rows) {
    if (row.pageId != null) pageIds.add(row.pageId);
    else if (row.layoutId != null)
      layoutKeys.set(`${row.projectId}:${row.layoutId}`, {
        projectId: row.projectId,
        layoutId: row.layoutId,
      });
  }
  const now = Date.now();
  if (pageIds.size > 0) {
    yield* Effect.promise(() =>
      db
        .update(pages)
        .set({ contentUpdatedAt: now })
        .where(and(inArray(pages.id, [...pageIds]), storedIn(pages, null))),
    );
  }
  for (const layout of layoutKeys.values()) {
    yield* Effect.promise(() =>
      db
        .update(layouts)
        .set({ contentUpdatedAt: now })
        .where(layoutNamed(layout.projectId, layout.layoutId)),
    );
  }
});
