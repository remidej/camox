import type {
  FindingAbout,
  FindingFix,
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
    // The fingerprint of the draft's changes the check read: it's up to date while they're the
    // same. Null on Live, and for checks that don't read a draft's changes.
    fingerprint: text(),
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

/**
 * A problem a patroller found in content, open until a check no longer finds it, a fix is
 * applied, or a member dismisses what it's about (ADR 0034). In a draft (only in what it changed,
 * ending with it) or on Live (`draftId` null). Keyed by scope, patroller and key: its subject,
 * field and identity, so a check finding it again keeps it. Not content: never a change nor a
 * conflict.
 */
export const findings = sqliteTable(
  "findings",
  {
    rowId: int("row_id").primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
    patroller: text().notNull().$type<PatrollerId>(),
    key: text().notNull(),
    // Its subject: the content it's in, in a locale, and the field.
    entity: text().notNull().$type<ReportEntity>(),
    entityId: text("entity_id").notNull(),
    locale: text().notNull(),
    field: text().notNull(),
    // What a dismissal names: no finding of the same patroller and identity is raised again.
    identity: text().notNull(),
    about: text({ mode: "json" }).notNull().$type<FindingAbout>(),
    fix: text({ mode: "json" }).$type<FindingFix>(),
    raisedAt: int("raised_at").notNull(),
  },
  (table) => [
    uniqueIndex("findings_live_idx")
      .on(table.projectId, table.patroller, table.key)
      .where(sql`${table.draftId} is null`),
    uniqueIndex("findings_draft_idx")
      .on(table.draftId, table.patroller, table.key)
      .where(sql`${table.draftId} is not null`),
    index("findings_identity_idx").on(table.projectId, table.patroller, table.identity),
  ],
);

/**
 * A member's dismissal of a finding's identity, the project's (ADR 0034): it holds in every scope
 * at once and survives the draft it was made in, so it references no draft. Who dismissed it
 * isn't a reference either: it stays after they leave. Never content, a change nor a conflict.
 */
export const findingDismissals = sqliteTable(
  "finding_dismissals",
  {
    rowId: int("row_id").primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    patroller: text().notNull().$type<PatrollerId>(),
    identity: text().notNull(),
    // What the dismissed finding was about, for the history.
    about: text({ mode: "json" }).notNull().$type<FindingAbout>(),
    dismissedBy: text("dismissed_by").notNull(),
    dismissedAt: int("dismissed_at").notNull(),
  },
  (table) => [
    uniqueIndex("finding_dismissals_identity_idx").on(
      table.projectId,
      table.patroller,
      table.identity,
    ),
  ],
);
