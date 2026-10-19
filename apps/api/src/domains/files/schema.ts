import { generateUuidv7 } from "@camox/api-contract/ids";
import { sql } from "drizzle-orm";
import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { drafts } from "../drafts/schema";
import { projects } from "../projects/schema";

/**
 * A file: an uploaded image, video or document whose bytes are a blob in R2.
 *
 * Live and every draft store files side by side (ADR 0005), like blocks: a draft row is the
 * draft's copy of a file, a file the draft uploaded, or a tombstone. Replacing a file's content
 * copies it with a new blob and keeps its id, so Live keeps serving the old blob until the draft
 * is published. A blob is deleted once no row in Live or any draft names it. Read and write
 * files through the draft overlay.
 */
export const files = sqliteTable(
  "files",
  {
    rowId: int("row_id").primaryKey(),
    id: text().notNull().$defaultFn(generateUuidv7),
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    // Live: the number of changes made to the row. Unused on draft rows (last write wins).
    version: int().notNull().default(1),
    // The Live version a draft copy started from. Null on Live rows and on files a draft created.
    baseVersion: int("base_version"),
    // A draft's deletion of the file.
    deleted: int({ mode: "boolean" }).notNull().default(false),
    firstPublishedAt: int("first_published_at"),
    publishedAt: int("published_at"),
    publishedBy: text("published_by"),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    url: text().notNull(),
    // Manual metadata in the default locale, all null or all set (ADR 0012): null means the
    // generated values apply.
    alt: text(),
    filename: text(),
    // Manual alt text in locales other than the default one, by tag: a locale missing here gets
    // generated alt text. Files aren't localized, and the filename is the default locale's.
    altsByLocale: text("alts_by_locale", { mode: "json" })
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'`),
    mimeType: text("mime_type").notNull(),
    size: int().notNull(),
    optimizedSize: int("optimized_size"),
    blobId: text("blob_id").notNull(),
    path: text().notNull(),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("files_live_id_idx")
      .on(table.id)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("files_draft_id_idx")
      .on(table.draftId, table.id)
      .where(sql`${table.draftId} is not null`),
    index("files_blob_id_idx").on(table.blobId),
    index("files_project_idx").on(table.projectId),
  ],
);
