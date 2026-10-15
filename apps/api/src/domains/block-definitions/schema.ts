import { index, int, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { environments, projects } from "../projects/schema";

export const blockDefinitions = sqliteTable(
  "block_definitions",
  {
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    environmentId: int("environment_id")
      .notNull()
      .references(() => environments.id),
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
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.environmentId, table.blockId] }),
    index("block_definitions_environment_block_idx").on(table.environmentId, table.blockId),
  ],
);
