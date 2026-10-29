import type {
  PatrollerId,
  ReportEntity,
  ReportOutcome,
  ReportVerb,
} from "@camox/api-contract/patrol";
import { sql } from "drizzle-orm";
import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { drafts } from "../drafts/schema";
import { projects } from "../projects/schema";

/**
 * What a report stores as its summary (ADR 0024): structured facts, whose subject the Patrol
 * read names and which the studio turns into a sentence, or text an AI wrote, kept as is.
 */
export type StoredSummary =
  | {
      kind: "structured";
      verb: ReportVerb;
      subject: { entity: ReportEntity; id: string } | null;
      locale: string | null;
    }
  | { kind: "text"; text: string };

/**
 * A patroller's account of the last thing it did to one subject in one locale, or of one run,
 * in a draft or on Live (`draftId` null). Keyed by project, scope, patroller and report key:
 * redoing the work updates the report. Not content: writing one is never a change nor a
 * conflict. A draft's reports end with it, when it's published or deleted.
 */
export const reports = sqliteTable(
  "reports",
  {
    rowId: int("row_id").primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    patroller: text().notNull().$type<PatrollerId>(),
    // What the work was on, as its patroller names it: its subject and locale, or a run.
    key: text().notNull(),
    summary: text({ mode: "json" }).notNull().$type<StoredSummary>(),
    outcome: text().notNull().$type<ReportOutcome>(),
    // When the work last settled.
    at: int().notNull(),
  },
  (table) => [
    uniqueIndex("reports_live_idx")
      .on(table.projectId, table.patroller, table.key)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("reports_draft_idx")
      .on(table.draftId, table.patroller, table.key)
      .where(sql`${table.draftId} is not null`),
    index("reports_project_idx").on(table.projectId),
  ],
);

/**
 * When a patroller last finished a check in a scope, a draft or Live (`draftId` null), whether it
 * found anything or not (ADR 0034). One per project, scope and patroller. Like reports, not
 * content, and a draft's end with it.
 */
export const patrolChecks = sqliteTable(
  "patrol_checks",
  {
    rowId: int("row_id").primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    patroller: text().notNull().$type<PatrollerId>(),
    checkedAt: int("checked_at").notNull(),
  },
  (table) => [
    uniqueIndex("patrol_checks_live_idx")
      .on(table.projectId, table.patroller)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("patrol_checks_draft_idx")
      .on(table.draftId, table.patroller)
      .where(sql`${table.draftId} is not null`),
  ],
);
