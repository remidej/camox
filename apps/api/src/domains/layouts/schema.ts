import { sql } from "drizzle-orm";
import { int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { drafts } from "../drafts/schema";
import { projects } from "../projects/schema";

/** Which collection a layout's record pages render, and the field they're found by. */
export type RecordPages = { collectionId: string; field: string };

/**
 * A layout definition, stored like block definitions: Live's have no draft, a development
 * draft's carry its id (ADR 0006). Read them through `definitionsIn`.
 */
export const layouts = sqliteTable(
  "layouts",
  {
    rowId: int("row_id").primaryKey(),
    // The development draft holding this layout, or null for Live's.
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    // The layout's name, given by code. It identifies the layout within a project.
    layoutId: text("layout_id").notNull(),
    description: text(),
    kind: text({ enum: ["curated", "derived", "singleton"] })
      .notNull()
      .default("curated"),
    // A derived layout's record pages: each renders a record of the collection, found by the
    // plain text of its `field`. Code declares it; publishing checks values stay unique.
    recordPages: text("record_pages", { mode: "json" }).$type<RecordPages>(),
    // What shapes content, hashed (`_shared/schema-hash.ts`): a development draft publishes only
    // while its definitions' names and hashes equal Live's (ADR 0006).
    schemaHash: text("schema_hash").notNull().default(""),
    contentUpdatedAt: int("content_updated_at").notNull(),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("layouts_live_idx")
      .on(table.projectId, table.layoutId)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("layouts_draft_idx")
      .on(table.draftId, table.layoutId)
      .where(sql`${table.draftId} is not null`),
  ],
);
