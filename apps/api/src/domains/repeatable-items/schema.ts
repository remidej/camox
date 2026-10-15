import { generateUuidv7 } from "@camox/api-contract/ids";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  int,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

import { blocks } from "../blocks/schema";
import { environments } from "../projects/schema";

/**
 * One entry of a repeater field. Its owner is a block, another repeatable item, or a synced block
 * definition's shared content. Every item also names the root of its tree: a block
 * (`blockId`), or a shared content (`environmentId` and `sharedContentType`).
 */
export const repeatableItems = sqliteTable(
  "repeatable_items",
  {
    id: text().primaryKey().$defaultFn(generateUuidv7),
    blockId: text("block_id").references(() => blocks.id, { onDelete: "cascade" }),
    // The shared content at the root of the tree, named by its environment and definition name.
    environmentId: int("environment_id").references(() => environments.id),
    sharedContentType: text("shared_content_type"),
    parentItemId: text("parent_item_id").references((): AnySQLiteColumn => repeatableItems.id, {
      onDelete: "cascade",
    }),
    fieldName: text("field_name").notNull(),
    content: text({ mode: "json" }).notNull(),
    settings: text({ mode: "json" }),
    summary: text().notNull().default(""),
    position: text().notNull(),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    index("repeatable_items_block_field_idx").on(table.blockId, table.fieldName),
    index("repeatable_items_block_idx").on(table.blockId),
    index("repeatable_items_parent_idx").on(table.parentItemId),
    index("repeatable_items_shared_content_idx").on(table.environmentId, table.sharedContentType),
    check(
      "repeatable_items_one_root",
      sql`(${table.blockId} is null) != (${table.sharedContentType} is null) and (${table.environmentId} is null) = (${table.sharedContentType} is null)`,
    ),
  ],
);
