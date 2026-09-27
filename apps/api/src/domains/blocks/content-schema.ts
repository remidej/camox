import { and, eq, or } from "drizzle-orm";

import type { Database } from "../../db";
import { blockDefinitions, blocks, layouts, pages } from "../../schema";
import type { SchemaProps } from "./normalize-content";

/** Content writes use the target block's environment, not the caller's default. */
export async function loadBlockContentSchema(
  db: Database,
  projectId: number,
  blockId: number,
): Promise<{ properties?: SchemaProps } | null> {
  const definition = await db
    .select({ contentSchema: blockDefinitions.contentSchema })
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
  return (definition?.contentSchema as { properties?: SchemaProps } | null) ?? null;
}
