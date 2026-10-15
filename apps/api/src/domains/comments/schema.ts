import type { CommentTarget } from "@camox/api-contract";
import { index, int, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "../auth/schema";
import { drafts } from "../drafts/schema";
import { environments } from "../projects/schema";

export const comments = sqliteTable(
  "comments",
  {
    id: text().primaryKey(),
    environmentId: int("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    // Where the comment was written: Live (null), seen in every draft, or a draft, seen only
    // there and deleted with it (#241).
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    // A Live comment resolved from inside a draft: publishing that draft resolves it, and
    // discarding it clears the mark.
    addressedInDraftId: text("addressed_in_draft_id").references(() => drafts.id, {
      onDelete: "set null",
    }),
    // No foreign keys to content: an id is unique only within Live or within one draft
    // (ADR 0005). Deleting a page deletes its comments, and null anchors keep feedback whose
    // block or item was deleted.
    pageId: text("page_id").notNull(),
    blockId: text("block_id"),
    itemId: text("item_id"),
    target: text({ mode: "json" }).$type<CommentTarget>(),
    message: text().notNull(),
    resolved: int({ mode: "boolean" }).notNull().default(false),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    createdAt: int("created_at").notNull(),
  },
  (table) => [
    index("comments_page_idx").on(table.pageId, table.createdAt),
    index("comments_environment_idx").on(table.environmentId),
    index("comments_block_idx").on(table.blockId),
    index("comments_item_idx").on(table.itemId),
    index("comments_draft_idx").on(table.draftId),
    index("comments_addressed_in_draft_idx").on(table.addressedInDraftId),
  ],
);
