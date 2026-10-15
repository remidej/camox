import { generateUuidv7 } from "@camox/api-contract/ids";
import { sql } from "drizzle-orm";
import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { drafts } from "../drafts/schema";
import { environments } from "../projects/schema";

/**
 * A block. A placement of a synced block definition holds only its identity, position and
 * slot: its content and settings live in the definition's shared content.
 *
 * Live and every draft store blocks side by side (ADR 0005): a Live row has no draft, a draft
 * row is the draft's copy of a block, a block the draft created, or a tombstone. An id is unique
 * within Live and within each draft, so rows are keyed by `rowId` and no other content table
 * holds a foreign key to blocks. Read and write blocks through the draft overlay.
 */
export const blocks = sqliteTable(
  "blocks",
  {
    rowId: int("row_id").primaryKey(),
    id: text().notNull().$defaultFn(generateUuidv7),
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    // Live: the number of changes made to the row. Unused on draft rows (last write wins).
    version: int().notNull().default(1),
    // The Live version a draft copy started from. Null on Live rows and on blocks a draft created.
    baseVersion: int("base_version"),
    // A draft's deletion of the block.
    deleted: int({ mode: "boolean" }).notNull().default(false),
    firstPublishedAt: int("first_published_at"),
    publishedAt: int("published_at"),
    publishedBy: text("published_by"),
    environmentId: int("environment_id")
      .notNull()
      .references(() => environments.id),
    // No foreign key: content tables don't reference each other (ADR 0005).
    pageId: text("page_id"),
    // The name of the layout whose slot holds this block. Deleting a layout deletes its blocks.
    layoutId: text("layout_id"),
    type: text().notNull(),
    content: text({ mode: "json" }).notNull(),
    settings: text({ mode: "json" }),
    slot: text().$type<"before" | "after">(),
    position: text().notNull(),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("blocks_live_id_idx")
      .on(table.id)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("blocks_draft_id_idx")
      .on(table.draftId, table.id)
      .where(sql`${table.draftId} is not null`),
    index("blocks_page_idx").on(table.pageId),
    index("blocks_layout_idx").on(table.environmentId, table.layoutId),
    index("blocks_type_idx").on(table.type),
  ],
);

/**
 * The shared content of a synced block definition (ADR 0004, 0005): one entity per definition
 * name and environment, shown by every placement of the definition. It owns its repeatable
 * items.
 *
 * Live and every draft store it side by side, like blocks. Its id is derived from the
 * definition it belongs to (`sharedContentId`), so Live and every draft name the same entity.
 */
export const sharedContents = sqliteTable(
  "shared_contents",
  {
    rowId: int("row_id").primaryKey(),
    id: text().notNull(),
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    // Live: the number of changes made to the row. Unused on draft rows (last write wins).
    version: int().notNull().default(1),
    // The Live version a draft copy started from. Null on Live rows and on rows a draft created.
    baseVersion: int("base_version"),
    // A draft's deletion of the shared content.
    deleted: int({ mode: "boolean" }).notNull().default(false),
    firstPublishedAt: int("first_published_at"),
    publishedAt: int("published_at"),
    publishedBy: text("published_by"),
    environmentId: int("environment_id")
      .notNull()
      .references(() => environments.id),
    // The name of the synced block definition.
    type: text().notNull(),
    content: text({ mode: "json" }).notNull(),
    settings: text({ mode: "json" }),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("shared_contents_live_id_idx")
      .on(table.id)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("shared_contents_draft_id_idx")
      .on(table.draftId, table.id)
      .where(sql`${table.draftId} is not null`),
    index("shared_contents_definition_idx").on(table.environmentId, table.type),
  ],
);

/** The id of a definition's shared content, the same in Live and in every draft. */
export function sharedContentId(key: { environmentId: number; type: string }) {
  return `${key.environmentId}:${key.type}`;
}
