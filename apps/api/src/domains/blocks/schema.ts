import { generateUuidv7 } from "@camox/api-contract/ids";
import { index, int, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { pages } from "../pages/schema";
import { environments } from "../projects/schema";

/**
 * A block. A placement of a synced block definition holds only its identity, position and
 * slot: its content, settings and summary live in the definition's shared content.
 */
export const blocks = sqliteTable(
  "blocks",
  {
    id: text().primaryKey().$defaultFn(generateUuidv7),
    environmentId: int("environment_id")
      .notNull()
      .references(() => environments.id),
    pageId: text("page_id").references(() => pages.id, { onDelete: "cascade" }),
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

/**
 * The shared content of a synced block definition (ADR 0004, 0005): one entity per definition
 * name and environment, shown by every placement of the definition. It owns its repeatable
 * items.
 */
export const sharedContents = sqliteTable(
  "shared_contents",
  {
    environmentId: int("environment_id")
      .notNull()
      .references(() => environments.id),
    // The name of the synced block definition.
    type: text().notNull(),
    content: text({ mode: "json" }).notNull(),
    settings: text({ mode: "json" }),
    summary: text().notNull().default(""),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.environmentId, table.type] })],
);
