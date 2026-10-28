import { sql } from "drizzle-orm";
import { int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { drafts } from "../drafts/schema";
import { projects } from "../projects/schema";

/**
 * A block definition. Live holds the released definitions (no draft), and a draft with code
 * holds the complete set its previewed revision synced (ADR 0006). Read them through
 * `definitionsIn`, which picks the set a draft scope reads.
 */
export const blockDefinitions = sqliteTable(
  "block_definitions",
  {
    rowId: int("row_id").primaryKey(),
    // The draft with code holding this definition, or null for Live's.
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    // The block definition's name, given by code. It identifies the definition within a project.
    blockId: text("block_id").notNull(),
    title: text().notNull(),
    description: text().notNull(),
    contentSchema: text("content_schema", { mode: "json" }).notNull(),
    settingsSchema: text("settings_schema", { mode: "json" }),
    defaultContent: text("default_content", { mode: "json" }),
    defaultSettings: text("default_settings", { mode: "json" }),
    layoutOnly: int("layout_only", { mode: "boolean" }),
    synced: int({ mode: "boolean" }).notNull().default(false),
    // What shapes content, hashed (`_shared/schema-hash.ts`).
    schemaHash: text("schema_hash").notNull().default(""),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("block_definitions_live_idx")
      .on(table.projectId, table.blockId)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("block_definitions_draft_idx")
      .on(table.draftId, table.blockId)
      .where(sql`${table.draftId} is not null`),
  ],
);
