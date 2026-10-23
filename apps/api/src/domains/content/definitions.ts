import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { blockDefinitions, collectionDefinitions } from "../../schema";
import { definitionsIn } from "../_shared/definitions";
import type { ContentScope } from "../collections/identity";

export type BlockDefinition = typeof blockDefinitions.$inferSelect;
export type CollectionDefinition = typeof collectionDefinitions.$inferSelect;

/** The definitions a scope reads, by name (ADR 0006). */
export type Definitions = {
  blocks: () => Effect.Effect<ReadonlyMap<string, BlockDefinition>>;
  collections: () => Effect.Effect<ReadonlyMap<string, CollectionDefinition>>;
};

/**
 * Runs `load` once, the first time its result is needed, and keeps the result. Reads asking for
 * it while it loads wait for the same load.
 */
function once<A>(load: () => Promise<A>): () => Effect.Effect<A> {
  let loading: Promise<A> | undefined;
  return () => Effect.promise(() => (loading ??= load()));
}

/**
 * The block and collection definitions of a project as a scope reads them: a development
 * draft's own, or Live's. Each is read at most once, the first time a read needs it. Content
 * reads never change definitions, so nothing invalidates them.
 */
export function definitionsOf(db: Database, at: ContentScope): Definitions {
  return {
    blocks: once(async () => {
      const rows = await db
        .select()
        .from(blockDefinitions)
        .where(
          and(
            eq(blockDefinitions.projectId, at.projectId),
            definitionsIn(blockDefinitions, at.draft),
          ),
        );
      return new Map(rows.map((row) => [row.blockId, row]));
    }),
    collections: once(async () => {
      const rows = await db
        .select()
        .from(collectionDefinitions)
        .where(
          and(
            eq(collectionDefinitions.projectId, at.projectId),
            definitionsIn(collectionDefinitions, at.draft),
          ),
        );
      return new Map(rows.map((row) => [row.collectionId, row]));
    }),
  };
}
