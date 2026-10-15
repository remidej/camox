import { generateUuidv7 } from "@camox/api-contract/ids";
import { sql } from "drizzle-orm";
import { check, index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { drafts } from "../drafts/schema";
import { environments } from "../projects/schema";

/**
 * One entry of a repeater field. Its owner is a block, another repeatable item, or a synced block
 * definition's shared content. Every item also names the root of its tree: a block
 * (`blockId`), or a shared content (`environmentId` and `sharedContentType`).
 *
 * Live and every draft store items side by side (ADR 0005), like blocks. An id is unique within
 * Live and within each draft. Read and write items through the draft overlay.
 */
export const repeatableItems = sqliteTable(
  "repeatable_items",
  {
    rowId: int("row_id").primaryKey(),
    id: text().notNull().$defaultFn(generateUuidv7),
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    // Live: the number of changes made to the row. Unused on draft rows (last write wins).
    version: int().notNull().default(1),
    // The Live version a draft copy started from. Null on Live rows and on items a draft created.
    baseVersion: int("base_version"),
    // A draft's deletion of the item.
    deleted: int({ mode: "boolean" }).notNull().default(false),
    firstPublishedAt: int("first_published_at"),
    publishedAt: int("published_at"),
    publishedBy: text("published_by"),
    // No foreign key: a block id is unique only within Live or within one draft (ADR 0005).
    blockId: text("block_id"),
    // The shared content at the root of the tree, named by its environment and definition name.
    environmentId: int("environment_id").references(() => environments.id),
    sharedContentType: text("shared_content_type"),
    // No foreign key either, for the same reason.
    parentItemId: text("parent_item_id"),
    fieldName: text("field_name").notNull(),
    content: text({ mode: "json" }).notNull(),
    settings: text({ mode: "json" }),
    summary: text().notNull().default(""),
    position: text().notNull(),
    createdAt: int("created_at").notNull(),
    // On a tombstone, when the draft deleted the item.
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("repeatable_items_live_id_idx")
      .on(table.id)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("repeatable_items_draft_id_idx")
      .on(table.draftId, table.id)
      .where(sql`${table.draftId} is not null`),
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
