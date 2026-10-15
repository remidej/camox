import { index, int, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { environments, projects } from "../projects/schema";

/** Which collection a layout's record pages render, and the field they're found by. */
export type RecordPages = { collectionId: string; field: string };

export const layouts = sqliteTable(
  "layouts",
  {
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    environmentId: int("environment_id")
      .notNull()
      .references(() => environments.id),
    // The layout's name, given by code. It identifies the layout within a project.
    layoutId: text("layout_id").notNull(),
    description: text(),
    kind: text({ enum: ["curated", "derived", "singleton"] })
      .notNull()
      .default("curated"),
    // A derived layout's record pages: each renders a record of the collection, found by the
    // plain text of its `field`. Code declares it; publishing checks values stay unique.
    recordPages: text("record_pages", { mode: "json" }).$type<RecordPages>(),
    contentUpdatedAt: int("content_updated_at").notNull(),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.environmentId, table.layoutId] }),
    index("layouts_environment_layout_idx").on(table.environmentId, table.layoutId),
  ],
);
