import type { DraftKind } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { index, int, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { projects } from "../projects/schema";

/** A draft: a named set of content changes over Live, owned by a project (ADR 0011). */
export const drafts = sqliteTable(
  "drafts",
  {
    id: text().primaryKey().$defaultFn(generateUuidv7),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text().notNull().$type<DraftKind>(),
    name: text(),
    // The creating user's id. No foreign key, so a departed member's draft survives.
    createdBy: text("created_by").notNull(),
    createdAt: int("created_at").notNull(),
  },
  (table) => [index("drafts_project_idx").on(table.projectId)],
);
