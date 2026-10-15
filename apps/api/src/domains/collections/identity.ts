import { and, eq } from "drizzle-orm";

import { collectionDefinitions, collectionRecords } from "./schema";

// A collection is identified by its name within a project's environment (ADR 0004).
// Its records point at it by that name.

type CollectionKey = { environmentId: number; collectionId: string };

/** The records of a collection. */
export function recordsOf(collection: CollectionKey) {
  return and(
    eq(collectionRecords.environmentId, collection.environmentId),
    eq(collectionRecords.collectionId, collection.collectionId),
  );
}

/** The collection definition with this name in an environment. */
export function collectionNamed(collection: CollectionKey) {
  return and(
    eq(collectionDefinitions.environmentId, collection.environmentId),
    eq(collectionDefinitions.collectionId, collection.collectionId),
  );
}

/** Join condition from a record to its collection's definition. */
export const collectionOfRecord = and(
  eq(collectionDefinitions.environmentId, collectionRecords.environmentId),
  eq(collectionDefinitions.collectionId, collectionRecords.collectionId),
);
