import { ORPCError } from "@orpc/server";
import { sql } from "drizzle-orm";

import type { Database } from "../../db";
import { collectionRecords, collectionRevisions } from "./schema";

/** Run before touching R2: history must not lose assets through the media library. */
export async function assertNoCollectionAssetUse(db: Database, ids: number[]) {
  for (const id of ids) {
    const draft = await db
      .select({ id: collectionRecords.id })
      .from(collectionRecords)
      .where(
        sql`exists (select 1 from json_tree(${collectionRecords.draft}) where key = '_fileId' and value = ${String(id)})`,
      )
      .get();
    const revision = await db
      .select({ id: collectionRevisions.id })
      .from(collectionRevisions)
      .where(
        sql`exists (select 1 from json_tree(${collectionRevisions.content}) where key = '_fileId' and value = ${String(id)})`,
      )
      .get();
    if (draft || revision) {
      throw new ORPCError("CONFLICT", {
        message: "This asset is retained by a collection draft or immutable revision",
      });
    }
  }
}
