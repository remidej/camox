import { index, int, sqliteTable, text, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { blocks } from "../blocks/schema";

export const repeatableItems = sqliteTable(
  "repeatable_items",
  {
    id: int().primaryKey({ autoIncrement: true }),
    blockId: int("block_id")
      .notNull()
      .references(() => blocks.id, { onDelete: "cascade" }),
    parentItemId: int("parent_item_id").references((): AnySQLiteColumn => repeatableItems.id, {
      onDelete: "cascade",
    }),
    // Stable identity across copies of a synced block's item tree.
    syncKey: text("sync_key"),
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
  ],
);
