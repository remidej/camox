import { and, eq, or } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { blockDefinitions, blocks, layouts, pages } from "../../schema";
import type { FieldSchema } from "./normalize-content";

/** Content writes use the target block's environment, not the caller's default. */
export const loadBlockSchemas = Effect.fn("loadBlockSchemas")(function* (
  db: Database,
  projectId: number,
  blockId: number,
): Effect.fn.Return<{
  contentSchema: FieldSchema | null;
  settingsSchema: FieldSchema | null;
} | null> {
  const definition = yield* Effect.promise(() =>
    db
      .select({
        contentSchema: blockDefinitions.contentSchema,
        settingsSchema: blockDefinitions.settingsSchema,
      })
      .from(blocks)
      .leftJoin(pages, eq(blocks.pageId, pages.id))
      .leftJoin(layouts, eq(blocks.layoutId, layouts.id))
      .innerJoin(
        blockDefinitions,
        and(
          eq(blockDefinitions.projectId, projectId),
          eq(blockDefinitions.blockId, blocks.type),
          or(
            eq(blockDefinitions.environmentId, pages.environmentId),
            eq(blockDefinitions.environmentId, layouts.environmentId),
          ),
        ),
      )
      .where(eq(blocks.id, blockId))
      .get(),
  );
  if (!definition) return null;
  return {
    contentSchema: definition.contentSchema as FieldSchema | null,
    settingsSchema: definition.settingsSchema as FieldSchema | null,
  };
});

export const loadBlockContentSchema = Effect.fn("loadBlockContentSchema")(function* (
  db: Database,
  projectId: number,
  blockId: number,
) {
  return (yield* loadBlockSchemas(db, projectId, blockId))?.contentSchema ?? null;
});
