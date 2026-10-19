import { generateUuidv7 } from "@camox/api-contract/ids";
import { sql } from "drizzle-orm";
import { int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { drafts } from "../drafts/schema";
import { projects } from "../projects/schema";

/**
 * A locale the website is published in, named by its BCP 47 tag, such as `en` or `pt-BR`. One
 * locale of each project is its default locale. Every page, block, repeatable item, shared
 * content and collection record is stored once per locale, identified by its id and its
 * locale's tag (ADR 0015).
 *
 * Locales are content: Live and every draft store them side by side (ADR 0005), like pages. A
 * Live row has no draft, a draft row is the draft's copy of a locale, a locale the draft added,
 * or a tombstone. Read and write locales through the draft overlay.
 */
export const locales = sqliteTable(
  "locales",
  {
    rowId: int("row_id").primaryKey(),
    id: text().notNull().$defaultFn(generateUuidv7),
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    // Live: the number of changes made to the row. Unused on draft rows (last write wins).
    version: int().notNull().default(1),
    // The Live version a draft copy started from. Null on Live rows and on locales a draft added.
    baseVersion: int("base_version"),
    // A draft's removal of the locale.
    deleted: int({ mode: "boolean" }).notNull().default(false),
    firstPublishedAt: int("first_published_at"),
    publishedAt: int("published_at"),
    publishedBy: text("published_by"),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    // The BCP 47 tag, which content rows name as their locale.
    tag: text().notNull(),
    isDefault: int("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: int("created_at").notNull(),
    // On a tombstone, when the draft removed the locale.
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("locales_live_id_idx")
      .on(table.id)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("locales_draft_id_idx")
      .on(table.draftId, table.id)
      .where(sql`${table.draftId} is not null`),
    uniqueIndex("locales_live_tag_idx")
      .on(table.projectId, table.tag)
      .where(sql`${table.draftId} is null`),
    // Live has one default locale per project.
    uniqueIndex("locales_live_default_idx")
      .on(table.projectId)
      .where(sql`${table.draftId} is null and ${table.isDefault} = 1`),
  ],
);

/** The default locale a project starts with, and the one existing content was migrated to. */
export const INITIAL_LOCALE = "en";
