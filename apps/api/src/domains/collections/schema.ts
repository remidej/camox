import {
  index,
  int,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

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
    active: int({ mode: "boolean" }).notNull().default(true),
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
    draft: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    version: int().notNull().default(1),
    publishedRevisionId: text("published_revision_id").references(
      (): AnySQLiteColumn => collectionRevisions.id,
    ),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [index("collection_records_definition").on(table.definitionId)],
);

export const collectionRevisions = sqliteTable(
  "collection_revisions",
  {
    id: text().primaryKey(),
    recordId: text("record_id")
      .notNull()
      .references((): AnySQLiteColumn => collectionRecords.id),
    kind: text().notNull().$type<"manual" | "auto-publish" | "auto-draft">(),
    content: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    definition: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    schemaVersion: int("schema_version").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: int("created_at").notNull(),
  },
  (table) => [index("collection_revisions_record").on(table.recordId)],
);
