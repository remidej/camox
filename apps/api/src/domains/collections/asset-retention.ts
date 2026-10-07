import { sql } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { ConflictError } from "../../lib/errors";
import { collectionRecords, collectionRevisions } from "./schema";

/** Run before touching R2: history must not lose assets through the media library. */
export const assertNoCollectionAssetUse = Effect.fn("collections.assertNoCollectionAssetUse")(
  function* (db: Database, ids: number[]) {
    for (const id of ids) {
      const draft = yield* Effect.promise(() =>
        db
          .select({ id: collectionRecords.id })
          .from(collectionRecords)
          .where(
            sql`exists (select 1 from json_tree(${collectionRecords.draft}) where key = '_fileId' and value = ${String(id)})`,
          )
          .get(),
      );
      const revision = yield* Effect.promise(() =>
        db
          .select({ id: collectionRevisions.id })
          .from(collectionRevisions)
          .where(
            sql`exists (select 1 from json_tree(${collectionRevisions.content}) where key = '_fileId' and value = ${String(id)})`,
          )
          .get(),
      );
      if (draft || revision) {
        return yield* new ConflictError({
          message: "This asset is retained by a collection draft or immutable revision",
        });
      }
    }
  },
);
