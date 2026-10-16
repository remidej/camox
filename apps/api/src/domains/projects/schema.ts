import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { organizationTable } from "../auth/schema";

export const projects = sqliteTable(
  "projects",
  {
    id: int().primaryKey({ autoIncrement: true }),
    slug: text().notNull(),
    name: text().notNull(),
    deployToken: text("deploy_token").notNull().default(""),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("projects_slug_idx").on(table.slug),
    index("projects_organization_idx").on(table.organizationId),
  ],
);
