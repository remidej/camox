import { index, int, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "../auth/schema";
import { environments } from "../projects/schema";

export const layoutCheckpoints = sqliteTable(
  "layout_checkpoints",
  {
    id: int().primaryKey({ autoIncrement: true }),
    environmentId: int("environment_id")
      .notNull()
      .references(() => environments.id),
    // The layout's name. Deleting a layout deletes its checkpoints.
    layoutId: text("layout_id").notNull(),
    kind: text().notNull().$type<"auto-publish" | "manual" | "auto-draft">(),
    label: text(),
    snapshot: text().notNull(),
    schemaVersion: int("schema_version").notNull(),
    createdAt: int("created_at").notNull(),
    createdBy: text("created_by").references(() => user.id),
  },
  (table) => [
    index("layout_checkpoints_layout_created_idx").on(
      table.environmentId,
      table.layoutId,
      table.createdAt,
    ),
  ],
);
