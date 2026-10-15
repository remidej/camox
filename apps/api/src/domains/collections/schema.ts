import { index, int, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { environments, projects } from "../projects/schema";

export const collectionDefinitions = sqliteTable(
  "collection_definitions",
  {
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    environmentId: int("environment_id")
      .notNull()
      .references(() => environments.id),
    // The collection's name, given by code. It identifies the collection within a project.
    collectionId: text("collection_id").notNull(),
    title: text().notNull(),
    description: text().notNull(),
    label: text().notNull(),
    contentSchema: text("content_schema", { mode: "json" })
      .notNull()
      .$type<Record<string, unknown>>(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.environmentId, table.collectionId] })],
);

export const collectionRecords = sqliteTable(
  "collection_records",
  {
    id: text().primaryKey(),
    environmentId: int("environment_id")
      .notNull()
      .references(() => environments.id),
    // The collection's name.
    collectionId: text("collection_id").notNull(),
    content: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [index("collection_records_collection").on(table.environmentId, table.collectionId)],
);
