import { and, eq, or, sql, type SQL } from "drizzle-orm";

import { blocks } from "../blocks/schema";
import { repeatableItems } from "./schema";

/**
 * A block definition named within a project. It also identifies the definition's shared
 * content while the definition is synced (ADR 0004).
 */
export type DefinitionKey = { projectId: number; type: string };

/** The root of a repeatable item tree: a block, or a synced definition's shared content. */
export type ItemRoot = { blockId: string } | { sharedContent: DefinitionKey };

type ItemRootColumns = Pick<
  typeof repeatableItems.$inferSelect,
  "blockId" | "projectId" | "sharedContentType"
>;

/** The items in the tree under a root. */
export function itemsUnder(root: ItemRoot): SQL {
  if ("blockId" in root) return eq(repeatableItems.blockId, root.blockId);
  return and(
    eq(repeatableItems.projectId, root.sharedContent.projectId),
    eq(repeatableItems.sharedContentType, root.sharedContent.type),
  )!;
}

/** The columns placing an item in a root's tree. */
export function rootColumns(root: ItemRoot): ItemRootColumns {
  if ("blockId" in root) {
    return { blockId: root.blockId, projectId: null, sharedContentType: null };
  }
  return {
    blockId: null,
    projectId: root.sharedContent.projectId,
    sharedContentType: root.sharedContent.type,
  };
}

export function rootOfItem(item: ItemRootColumns): ItemRoot {
  if (item.blockId !== null) return { blockId: item.blockId };
  return {
    sharedContent: { projectId: item.projectId!, type: item.sharedContentType! },
  };
}

/** The ids of the blocks owning item trees, leaving out shared content. */
export function blockIdsOf(items: readonly Pick<ItemRootColumns, "blockId">[]) {
  return items.flatMap((item) => (item.blockId === null ? [] : [item.blockId]));
}

/** Items of a project's shared contents. */
export function sharedContentItemsIn(projectId: number) {
  return eq(repeatableItems.projectId, projectId);
}

/**
 * Every item of a project: items of its blocks, on pages and in layouts, and items of its synced
 * definitions' shared contents.
 */
export function itemsInProject(projectId: number) {
  return or(
    sql`${repeatableItems.blockId} in (select ${blocks.id} from ${blocks} where ${eq(blocks.projectId, projectId)})`,
    sharedContentItemsIn(projectId),
  )!;
}

/** The ids of the items nested under an item, at any depth. */
export function descendantIdsOf(
  items: readonly { id: string; parentItemId: string | null }[],
  id: string,
) {
  const found: string[] = [];
  const visit = (parentId: string) => {
    for (const item of items) {
      if (item.parentItemId !== parentId) continue;
      found.push(item.id);
      visit(item.id);
    }
  };
  visit(id);
  return found;
}
