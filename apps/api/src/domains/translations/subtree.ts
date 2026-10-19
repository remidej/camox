import { and, eq, inArray } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import type { Database } from "../../db";
import type { TranslatedEntity } from "../../lib/ai-job-queue";
import { blocks, pages, repeatableItems, sharedContents } from "../../schema";
import * as overlay from "../drafts/overlay";
import type { Draft, ReadScope } from "../drafts/scope";
import type { Translatable } from "./service";

/** An entity beneath another, with the draft storing its row, or null for Live's. */
export type Descendant = Translatable & { draftId: string | null };

/**
 * The entities beneath an entity, as `scope` reads them in its locale: a page's child pages,
 * recursively, and their blocks; a block's items; an item's nested items; a shared content's
 * items. The entity itself needn't be there any more.
 */
export const descendantsOf = Effect.fn("translations.descendantsOf")(function* (
  db: Database,
  scope: ReadScope,
  root: Translatable,
) {
  const found = new Map<string, Descendant>();
  const add = (entity: TranslatedEntity, rows: { id: string; draftId: string | null }[]) => {
    const fresh = rows.filter((row) => row.id !== root.id && !found.has(row.id));
    for (const { id, draftId } of fresh) found.set(id, { entity, id, draftId });
    return fresh.map(({ id }) => id);
  };
  const childrenOf = (table: overlay.ContentTable, column: AnySQLiteColumn, parents: string[]) =>
    parents.length === 0
      ? Effect.succeed([])
      : (overlay.select(db, scope, table, inArray(column, parents)) as Effect.Effect<
          { id: string; draftId: string | null }[]
        >);

  let blockIds: string[] = [];
  let itemIds: string[] = [];
  if (root.entity === "page") {
    const pageIds = [root.id];
    for (let level = [root.id]; level.length > 0;) {
      level = add("page", yield* childrenOf(pages, pages.parentPageId, level));
      pageIds.push(...level);
    }
    blockIds = add("block", yield* childrenOf(blocks, blocks.pageId, pageIds));
  } else if (root.entity === "block") {
    blockIds = [root.id];
  } else if (root.entity === "repeatableItem") {
    itemIds = [root.id];
  } else if (root.entity === "sharedContent") {
    const shared = yield* overlay.get(db, scope, sharedContents, root.id);
    if (shared) {
      add(
        "repeatableItem",
        yield* overlay.select(
          db,
          scope,
          repeatableItems,
          and(
            eq(repeatableItems.projectId, shared.projectId),
            eq(repeatableItems.sharedContentType, shared.type),
          ),
        ),
      );
    }
  }
  // Every item of a block names the block, nested ones too.
  add("repeatableItem", yield* childrenOf(repeatableItems, repeatableItems.blockId, blockIds));
  for (let level = itemIds; level.length > 0;) {
    level = add(
      "repeatableItem",
      yield* childrenOf(repeatableItems, repeatableItems.parentItemId, level),
    );
  }
  return [...found.values()];
});

/**
 * Drops what a draft stores beneath an entity it deleted from a locale, in that locale: the
 * localizations and the content created there only. Publishing deletes Live's.
 */
export const dropDescendants = Effect.fn("translations.dropDescendants")(function* (
  db: Database,
  scope: Draft,
  root: Translatable,
) {
  for (const { entity, id, draftId } of yield* descendantsOf(db, scope, root)) {
    if (draftId === scope.id) yield* overlay.revert(db, scope, overlay.contentTableOf(entity), id);
  }
});
