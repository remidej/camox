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

export const environments = sqliteTable(
  "environments",
  {
    id: int().primaryKey({ autoIncrement: true }),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    name: text().notNull(),
    type: text().notNull().$type<"production" | "development">(),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("environments_project_name_idx").on(table.projectId, table.name),
    index("environments_project_idx").on(table.projectId),
  ],
);

export const aiJobs = sqliteTable(
  "ai_jobs",
  {
    id: int().primaryKey({ autoIncrement: true }),
    entityTable: text("entity_table")
      .notNull()
      .$type<"repeatableItems" | "blocks" | "files" | "pages">(),
    entityId: text("entity_id").notNull(),
    type: text().notNull().$type<"summary" | "fileMetadata" | "seo">(),
    status: text()
      .notNull()
      .default("pending")
      .$type<"pending" | "running" | "completed" | "failed">(),
    createdAt: int("created_at").notNull(),
  },
  (table) => [index("ai_jobs_entity_idx").on(table.entityTable, table.entityId, table.type)],
);
