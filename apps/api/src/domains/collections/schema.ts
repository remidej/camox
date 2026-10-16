import { generateUuidv7 } from "@camox/api-contract/ids";
import { sql } from "drizzle-orm";
import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { drafts } from "../drafts/schema";
import { projects } from "../projects/schema";

/**
 * A collection definition, stored like block definitions: Live's have no draft, a development
 * draft's carry its id (ADR 0006). Read them through `definitionsIn`.
 */
export const collectionDefinitions = sqliteTable(
  "collection_definitions",
  {
    rowId: int("row_id").primaryKey(),
    // The development draft holding this collection, or null for Live's.
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    // The collection's name, given by code. It identifies the collection within a project.
    collectionId: text("collection_id").notNull(),
    title: text().notNull(),
    description: text().notNull(),
    label: text().notNull(),
    contentSchema: text("content_schema", { mode: "json" })
      .notNull()
      .$type<Record<string, unknown>>(),
    // What shapes content, hashed (`_shared/schema-hash.ts`): a development draft publishes only
    // while its definitions' names and hashes equal Live's (ADR 0006).
    schemaHash: text("schema_hash").notNull().default(""),
  },
  (table) => [
    uniqueIndex("collection_definitions_live_idx")
      .on(table.projectId, table.collectionId)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("collection_definitions_draft_idx")
      .on(table.draftId, table.collectionId)
      .where(sql`${table.draftId} is not null`),
  ],
);

/**
 * A collection record. Live and every draft store records side by side (ADR 0005): a Live row
 * has no draft, a draft row is the draft's copy of a record, a record the draft created, or a
 * tombstone. Read and write records through the draft overlay.
 */
export const collectionRecords = sqliteTable(
  "collection_records",
  {
    rowId: int("row_id").primaryKey(),
    id: text().notNull().$defaultFn(generateUuidv7),
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    // Live: the number of changes made to the row. Unused on draft rows (last write wins).
    version: int().notNull().default(1),
    // The Live version a draft copy started from. Null on Live rows and on records a draft created.
    baseVersion: int("base_version"),
    // A draft's deletion of the record.
    deleted: int({ mode: "boolean" }).notNull().default(false),
    // Never moves once set, so lists sorted by it don't reorder when a record is edited.
    firstPublishedAt: int("first_published_at"),
    publishedAt: int("published_at"),
    publishedBy: text("published_by"),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    // The collection's name.
    collectionId: text("collection_id").notNull(),
    content: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("collection_records_live_id_idx")
      .on(table.id)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("collection_records_draft_id_idx")
      .on(table.draftId, table.id)
      .where(sql`${table.draftId} is not null`),
    index("collection_records_collection").on(table.projectId, table.collectionId),
  ],
);
