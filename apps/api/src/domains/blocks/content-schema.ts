import { and, eq, or } from "drizzle-orm";

import type { Database } from "../../db";
import { blockDefinitions, blocks, layouts, pages } from "../../schema";
import type { FieldSchema } from "./normalize-content";

/** Content writes use the target block's environment, not the caller's default. */
export async function loadBlockSchemas(
  db: Database,
  projectId: number,
  blockId: number,
): Promise<{ contentSchema: FieldSchema | null; settingsSchema: FieldSchema | null } | null> {
  const definition = await db
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
    .get();
  if (!definition) return null;
  return {
    contentSchema: definition.contentSchema as FieldSchema | null,
    settingsSchema: definition.settingsSchema as FieldSchema | null,
  };
}

export async function loadBlockContentSchema(db: Database, projectId: number, blockId: number) {
  return (await loadBlockSchemas(db, projectId, blockId))?.contentSchema ?? null;
}
