import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type { TranslatedEntity } from "../../lib/generation-scheduler";
import { drafts } from "../drafts/schema";
import { projects } from "../projects/schema";

/**
 * A pending translation job (ADR 0015): one per entity, locale and draft, from when the job is
 * requested until a job of that key finishes. A draft's pending translations are what it shows
 * as translating. A job whose row is gone does nothing: its draft ended, emptied or dropped the
 * locale since. Not content: writing it never counts as a change.
 */
export const translationRequests = sqliteTable(
  "translation_requests",
  {
    rowId: int("row_id").primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    entity: text().notNull().$type<TranslatedEntity>(),
    entityId: text("entity_id").notNull(),
    // The tag of the locale to translate into.
    locale: text().notNull(),
    // When a job of this key was last requested.
    requestedAt: int("requested_at").notNull(),
  },
  (table) => [
    uniqueIndex("translation_requests_key_idx").on(
      table.draftId,
      table.entity,
      table.entityId,
      table.locale,
    ),
    index("translation_requests_project_idx").on(table.projectId),
  ],
);
