import { and, eq } from "drizzle-orm";

import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { collectionDefinitions, collectionRecords } from "./schema";

// A collection is identified by its name within a project (ADR 0004).
// Its records point at it by that name.

type CollectionKey = { projectId: number; collectionId: string };

/** Where content and the records it links are read: a project, as Live or a draft. */
export type ContentScope = { projectId: number; draft: DraftScope };

/** The records of a collection as a scope reads them: a draft's copies over Live's. */
export function recordsOf(collection: CollectionKey, draft: DraftScope) {
  return and(
    eq(collectionRecords.projectId, collection.projectId),
    eq(collectionRecords.collectionId, collection.collectionId),
    overlay.visibleIn(collectionRecords, draft),
  );
}

/** Join condition from a record to its collection's definition. */
export const collectionOfRecord = and(
  eq(collectionDefinitions.projectId, collectionRecords.projectId),
  eq(collectionDefinitions.collectionId, collectionRecords.collectionId),
);
