import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { blockDefinitions, blocks } from "../../schema";
import { definitionsIn } from "../_shared/definitions";
import type { ReadScope } from "../drafts/scope";
import type { DefinitionKey } from "../repeatable-items/roots";
import type { FieldSchema } from "./normalize-content";

/**
 * Content writes use the target block's project and the
 * definitions the scope reads (ADR 0006). Callers without an authorized project (background
 * jobs) pass `null`: the block's project alone pins its definition.
 */
export const loadBlockSchemas = Effect.fn("loadBlockSchemas")(function* (
  db: Database,
  projectId: number | null,
  blockId: string,
  scope: ReadScope,
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
          eq(blockDefinitions.projectId, blocks.projectId),
          definitionsIn(blockDefinitions, scope),
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

/**
 * A block definition named within a project, as a scope reads it, or nothing when it's
 * gone.
 */
export const findDefinition = Effect.fn("findDefinition")(function* (
  db: Database,
  definition: DefinitionKey,
  scope: ReadScope,
) {
  return yield* Effect.promise(() =>
    db
      .select()
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, definition.projectId),
          eq(blockDefinitions.blockId, definition.type),
          definitionsIn(blockDefinitions, scope),
        ),
      )
      .get(),
  );
});

/** The schemas of a block definition, named within a project, as a scope reads it. */
export const loadDefinitionSchemas = Effect.fn("loadDefinitionSchemas")(function* (
  db: Database,
  key: DefinitionKey,
  scope: ReadScope,
) {
  const definition = yield* findDefinition(db, key, scope);
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
  scope: ReadScope,
) {
  return (yield* loadBlockSchemas(db, projectId, blockId, scope))?.contentSchema ?? null;
});
