import { int, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { projects } from "../projects/schema";

/**
 * Every artifact source a project's content has held, under its hash (`artifactSourceHash`), so
 * websites can load artifacts by URL (ADR 0002). Derived data, not content: neither Live nor any
 * draft owns a row, a row never changes, and old sources are kept, so a page cached before a
 * publish still loads exactly the artifacts it showed.
 */
export const artifactSources = sqliteTable(
  "artifact_sources",
  {
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    hash: text().notNull(),
    source: text().notNull(),
    createdAt: int("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.hash] })],
);
