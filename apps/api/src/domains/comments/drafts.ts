import { and, eq, isNull, ne, or, type SQL } from "drizzle-orm";

import type { Database } from "../../db";
import * as overlay from "../drafts/overlay";
import { comments } from "./schema";

// Comments are written where their author is (#241): on Live, seen in every draft, or in a
// draft, seen only there and ending with it. They aren't content the overlay copies, so ending a
// draft takes care of them with these statements, in the overlay's publish or discard batch.

/** Live comments the draft resolved, which its publish resolves on Live. */
const addressedIn = (draftId: string) =>
  and(isNull(comments.draftId), eq(comments.addressedInDraftId, draftId))!;

/**
 * Unresolved Live comments anchored to what the draft deletes, which its publish deletes. Those
 * the draft resolved aren't counted: the publish resolves them anyway.
 */
export function unresolvedLiveCommentsDeletedBy(draftId: string): SQL {
  return and(
    isNull(comments.draftId),
    eq(comments.resolved, false),
    or(isNull(comments.addressedInDraftId), ne(comments.addressedInDraftId, draftId)),
    overlay.anchoredToDeletionIn(draftId),
  )!;
}

/** Unresolved comments written in the draft, which block publishing it. */
export function unresolvedCommentsWrittenIn(draftId: string): SQL {
  return and(eq(comments.draftId, draftId), eq(comments.resolved, false))!;
}

/**
 * Publishing a draft deletes Live comments on what it deletes, resolves the Live comments it
 * addressed, and deletes its own comments, also when a development draft stays.
 */
export function publishStatements(db: Database, draftId: string): overlay.BatchItem[] {
  return [
    db.delete(comments).where(and(isNull(comments.draftId), overlay.anchoredToDeletionIn(draftId))),
    db
      .update(comments)
      .set({ resolved: true, addressedInDraftId: null })
      .where(addressedIn(draftId)),
    db.delete(comments).where(eq(comments.draftId, draftId)),
  ];
}

/** Discarding a draft clears the marks it left on Live comments, and deletes its own comments. */
export function discardStatements(db: Database, draftId: string): overlay.BatchItem[] {
  return [
    db.update(comments).set({ addressedInDraftId: null }).where(addressedIn(draftId)),
    db.delete(comments).where(eq(comments.draftId, draftId)),
  ];
}
