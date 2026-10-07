import { index, int, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { layouts } from "../layouts/schema";
import { pages } from "../pages/schema";

export const blocks = sqliteTable(
  "blocks",
  {
    id: int().primaryKey({ autoIncrement: true }),
    pageId: int("page_id").references(() => pages.id, { onDelete: "cascade" }),
    layoutId: int("layout_id").references(() => layouts.id, { onDelete: "cascade" }),
    type: text().notNull(),
    content: text({ mode: "json" }).notNull(),
    settings: text({ mode: "json" }),
    slot: text().$type<"before" | "after">(),
    summary: text().notNull().default(""),
    position: text().notNull(),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    index("blocks_page_idx").on(table.pageId),
    index("blocks_layout_idx").on(table.layoutId),
    index("blocks_type_idx").on(table.type),
  ],
);
