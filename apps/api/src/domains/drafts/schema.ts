import type { DraftKind, DraftOutcome } from "@camox/api-contract/drafts";
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

/**
 * The record a regular draft leaves when it's published or discarded, written in the batch
 * that deletes it (ADR 0009). It answers later requests naming the draft with who ended it and
 * how, makes retries safe, and keeps the create header from bringing the draft back.
 */
export const endedDrafts = sqliteTable(
  "ended_drafts",
  {
    id: text().primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    outcome: text().notNull().$type<DraftOutcome>(),
    // The ending user's id. No foreign key, so the record outlives the member.
    endedBy: text("ended_by").notNull(),
    endedAt: int("ended_at").notNull(),
  },
  (table) => [index("ended_drafts_project_idx").on(table.projectId)],
);
