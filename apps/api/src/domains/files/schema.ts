import { index, int, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { environments, projects } from "../projects/schema";

export const files = sqliteTable(
  "files",
  {
    id: int().primaryKey({ autoIncrement: true }),
    projectId: int("project_id").references(() => projects.id),
    environmentId: int("environment_id")
      .notNull()
      .references(() => environments.id),
    url: text().notNull(),
    alt: text().notNull().default(""),
    filename: text().notNull(),
    mimeType: text("mime_type").notNull(),
    size: int().notNull(),
    optimizedSize: int("optimized_size"),
    blobId: text("blob_id").notNull(),
    path: text().notNull(),
    aiMetadataEnabled: int("ai_metadata_enabled", { mode: "boolean" }),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    index("files_blob_id_idx").on(table.blobId),
    index("files_project_idx").on(table.projectId),
    index("files_environment_idx").on(table.environmentId),
  ],
);
