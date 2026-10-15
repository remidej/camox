import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { blockDefinitions, blocks } from "../../schema";
import type { DefinitionKey } from "../repeatable-items/roots";
import type { FieldSchema } from "./normalize-content";

/**
 * Content writes use the target block's environment, not the caller's default. Callers without
 * an authorized project (background jobs) pass `null`: the block's environment alone pins its
 * definition.
 */
export const loadBlockSchemas = Effect.fn("loadBlockSchemas")(function* (
  db: Database,
  projectId: number | null,
  blockId: string,
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
      .innerJoin(
        blockDefinitions,
        and(
          projectId == null ? undefined : eq(blockDefinitions.projectId, projectId),
          eq(blockDefinitions.blockId, blocks.type),
          eq(blockDefinitions.environmentId, blocks.environmentId),
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

/** A block definition named within an environment, or nothing when it's gone. */
export const findDefinition = Effect.fn("findDefinition")(function* (
  db: Database,
  definition: DefinitionKey,
) {
  return yield* Effect.promise(() =>
    db
      .select()
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.environmentId, definition.environmentId),
          eq(blockDefinitions.blockId, definition.type),
        ),
      )
      .get(),
  );
});

/** The schemas of a block definition, named within an environment. */
export const loadDefinitionSchemas = Effect.fn("loadDefinitionSchemas")(function* (
  db: Database,
  key: DefinitionKey,
) {
  const definition = yield* findDefinition(db, key);
  if (!definition) return null;
  return {
    contentSchema: definition.contentSchema as FieldSchema | null,
    settingsSchema: definition.settingsSchema as FieldSchema | null,
  };
});

export const loadBlockContentSchema = Effect.fn("loadBlockContentSchema")(function* (
  db: Database,
  projectId: number,
  blockId: string,
) {
  return (yield* loadBlockSchemas(db, projectId, blockId))?.contentSchema ?? null;
});
