import { and, eq, inArray, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import { blocks } from "../blocks/schema";
import { repeatableItems } from "./schema";

/**
 * A block definition named within an environment. It also identifies the definition's shared
 * content while the definition is synced (ADR 0004).
 */
export type DefinitionKey = { environmentId: number; type: string };

/** The root of a repeatable item tree: a block, or a synced definition's shared content. */
export type ItemRoot = { blockId: string } | { sharedContent: DefinitionKey };

type ItemRootColumns = Pick<
  typeof repeatableItems.$inferSelect,
  "blockId" | "environmentId" | "sharedContentType"
>;

/** The items in the tree under a root. */
export function itemsUnder(root: ItemRoot): SQL {
  if ("blockId" in root) return eq(repeatableItems.blockId, root.blockId);
  return and(
    eq(repeatableItems.environmentId, root.sharedContent.environmentId),
    eq(repeatableItems.sharedContentType, root.sharedContent.type),
  )!;
}

/** The columns placing an item in a root's tree. */
export function rootColumns(root: ItemRoot): ItemRootColumns {
  if ("blockId" in root) {
    return { blockId: root.blockId, environmentId: null, sharedContentType: null };
  }
  return {
    blockId: null,
    environmentId: root.sharedContent.environmentId,
    sharedContentType: root.sharedContent.type,
  };
}

export function rootOfItem(item: ItemRootColumns): ItemRoot {
  if (item.blockId !== null) return { blockId: item.blockId };
  return {
    sharedContent: { environmentId: item.environmentId!, type: item.sharedContentType! },
  };
}

/** The ids of the blocks owning item trees, leaving out shared content. */
export function blockIdsOf(items: readonly Pick<ItemRootColumns, "blockId">[]) {
  return items.flatMap((item) => (item.blockId === null ? [] : [item.blockId]));
}

/** Items of the shared contents in one environment, or in several (a subquery of ids). */
export function sharedContentItemsIn(environment: number | SQLWrapper) {
  return typeof environment === "number"
    ? eq(repeatableItems.environmentId, environment)
    : inArray(repeatableItems.environmentId, environment);
}

/**
 * Every item of an environment, or of several (a subquery of ids): items of its blocks, on pages
 * and in layouts, and items of its synced definitions' shared contents.
 */
export function itemsInEnvironment(environment: number | SQLWrapper) {
  const blockEnvironment =
    typeof environment === "number"
      ? eq(blocks.environmentId, environment)
      : inArray(blocks.environmentId, environment);
  return or(
    sql`${repeatableItems.blockId} in (select ${blocks.id} from ${blocks} where ${blockEnvironment})`,
    sharedContentItemsIn(environment),
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
