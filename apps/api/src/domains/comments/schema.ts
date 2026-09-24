import type { CommentTarget } from "@camox/api-contract";
import { index, int, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "../auth/schema";
import { blocks } from "../blocks/schema";
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
    pageId: int("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    // Null anchors preserve feedback without reattaching it to a reused object ID.
    blockId: int("block_id").references(() => blocks.id, { onDelete: "set null" }),
    itemId: int("item_id").references(() => repeatableItems.id, { onDelete: "set null" }),
    target: text({ mode: "json" }).$type<CommentTarget>(),
    message: text().notNull(),
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
