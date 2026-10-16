import { generateUuidv7 } from "@camox/api-contract/ids";
import { sql } from "drizzle-orm";
import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "../auth/schema";
import { drafts } from "../drafts/schema";
import { projects } from "../projects/schema";

/**
 * A page. Live and every draft store pages side by side (ADR 0005), like blocks: a Live row has
 * no draft, a draft row is the draft's copy of a page, a page the draft created, or a tombstone.
 * An id is unique within Live and within each draft. Read and write pages through the draft
 * overlay.
 */
export const pages = sqliteTable(
  "pages",
  {
    rowId: int("row_id").primaryKey(),
    id: text().notNull().$defaultFn(generateUuidv7),
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    // Live: the number of changes made to the row. Unused on draft rows (last write wins).
    version: int().notNull().default(1),
    // The Live version a draft copy started from. Null on Live rows and on pages a draft created.
    baseVersion: int("base_version"),
    // A draft's deletion of the page.
    deleted: int({ mode: "boolean" }).notNull().default(false),
    firstPublishedAt: int("first_published_at"),
    publishedAt: int("published_at"),
    publishedBy: text("published_by"),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    pathSegment: text("path_segment").notNull(),
    fullPath: text("full_path").notNull(),
    // No foreign key: content tables don't reference each other (ADR 0005).
    parentPageId: text("parent_page_id"),
    // The layout's name.
    layoutId: text("layout_id").notNull(),
    nickname: text("nickname").notNull(),
    // Manual SEO, all null or all set (ADR 0012): null means the generated values apply.
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    customOgImageBlobId: text("custom_og_image_blob_id"),
    customOgImageUrl: text("custom_og_image_url"),
    contentUpdatedAt: int("content_updated_at").notNull(),
    createdById: text("created_by_id").references(() => user.id),
    createdAt: int("created_at").notNull(),
    // On a tombstone, when the draft deleted the page.
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("pages_live_id_idx")
      .on(table.id)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("pages_draft_id_idx")
      .on(table.draftId, table.id)
      .where(sql`${table.draftId} is not null`),
    index("pages_full_path_idx").on(table.fullPath),
    index("pages_parent_idx").on(table.parentPageId),
    index("pages_project_idx").on(table.projectId),
  ],
);
