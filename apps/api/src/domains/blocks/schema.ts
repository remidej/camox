import { index, int, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { pages } from "../pages/schema";
import { environments } from "../projects/schema";

export const blocks = sqliteTable(
  "blocks",
  {
    id: int().primaryKey({ autoIncrement: true }),
    environmentId: int("environment_id")
      .notNull()
      .references(() => environments.id),
    pageId: int("page_id").references(() => pages.id, { onDelete: "cascade" }),
    // The name of the layout whose slot holds this block. Deleting a layout deletes its blocks.
    layoutId: text("layout_id"),
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
    index("blocks_layout_idx").on(table.environmentId, table.layoutId),
    index("blocks_type_idx").on(table.type),
  ],
);
