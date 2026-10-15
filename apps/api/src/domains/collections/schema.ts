import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { environments, projects } from "../projects/schema";

export const collectionDefinitions = sqliteTable(
  "collection_definitions",
  {
    id: int().primaryKey({ autoIncrement: true }),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    environmentId: int("environment_id")
      .notNull()
      .references(() => environments.id),
    collectionId: text("collection_id").notNull(),
    title: text().notNull(),
    description: text().notNull(),
    label: text().notNull(),
    contentSchema: text("content_schema", { mode: "json" })
      .notNull()
      .$type<Record<string, unknown>>(),
  },
  (table) => [
    uniqueIndex("collection_definition_scope").on(
      table.projectId,
      table.environmentId,
      table.collectionId,
    ),
  ],
);

export const collectionRecords = sqliteTable(
  "collection_records",
  {
    id: text().primaryKey(),
    definitionId: int("definition_id")
      .notNull()
      .references(() => collectionDefinitions.id),
    content: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [index("collection_records_definition").on(table.definitionId)],
);
