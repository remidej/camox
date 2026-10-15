import type { CommentTarget } from "@camox/api-contract";
import { index, int, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "../auth/schema";
import { pages } from "../pages/schema";
import { environments } from "../projects/schema";
import { repeatableItems } from "../repeatable-items/schema";

export const comments = sqliteTable(
  "comments",
  {
    id: text().primaryKey(),
    environmentId: int("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    // Null anchors keep feedback whose block or item was deleted.
    // No foreign key: a block id is unique only within Live or within one draft (ADR 0005).
    blockId: text("block_id"),
    itemId: text("item_id").references(() => repeatableItems.id, { onDelete: "set null" }),
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
  ],
);
