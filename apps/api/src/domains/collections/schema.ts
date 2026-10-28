import { generateUuidv7 } from "@camox/api-contract/ids";
import { sql } from "drizzle-orm";
import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { drafts } from "../drafts/schema";
import { INITIAL_LOCALE } from "../locales/schema";
import { projects } from "../projects/schema";

/**
 * A collection definition, stored like block definitions: Live's have no draft, a draft with
 * code's carry its id (ADR 0006). Read them through `definitionsIn`.
 */
export const collectionDefinitions = sqliteTable(
  "collection_definitions",
  {
    rowId: int("row_id").primaryKey(),
    // The draft with code holding this collection, or null for Live's.
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    // The collection's name, given by code. It identifies the collection within a project.
    collectionId: text("collection_id").notNull(),
    title: text().notNull(),
    description: text().notNull(),
    // Token templates naming each record (`{{firstName}} {{lastName}}`), filled on read. A
    // collection without a description template gives its records none.
    toTitle: text("to_title").notNull(),
    toDescription: text("to_description"),
    // The JSON template of each record's Structured Data node, with field tokens; null when the
    // collection's records have none.
    toStructuredData: text("to_structured_data", { mode: "json" }).$type<Record<
      string,
      unknown
    > | null>(),
    contentSchema: text("content_schema", { mode: "json" })
      .notNull()
      .$type<Record<string, unknown>>(),
    // What shapes content, hashed (`_shared/schema-hash.ts`).
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
    // The tag of the locale this row belongs to: an id is unique per locale (ADR 0015). The overlay
    // sets it on every write; the default is the locale existing content was migrated to.
    locale: text().notNull().default(INITIAL_LOCALE),
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
      .on(table.id, table.locale)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("collection_records_draft_id_idx")
      .on(table.draftId, table.id, table.locale)
      .where(sql`${table.draftId} is not null`),
    index("collection_records_collection").on(table.projectId, table.collectionId),
  ],
);
