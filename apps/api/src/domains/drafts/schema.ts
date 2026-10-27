import type { DraftKind, DraftOutcome, PublishAbortReason } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { sql } from "drizzle-orm";
import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    // The draft's thread with Camox's agent, set aside when someone first opens it there, or the
    // Live thread whose write created the draft; a thread starts with its first message. It lives
    // in its own Durable Object, addressed by this id.
    threadId: text("thread_id"),
    // The Draft Overview AI writes about the draft's changes (`overview.ts`). It describes the
    // draft rather than its content, so it's never a change, a conflict or published, and goes
    // with the draft; emptying a development draft clears it.
    overviewHeadline: text("overview_headline"),
    overviewBullets: text("overview_bullets", { mode: "json" }).$type<string[]>(),
    overviewRequestedAt: int("overview_requested_at"),
    // When the last request's job is due to run: after the debounce, or right away.
    overviewDueAt: int("overview_due_at"),
    overviewGeneratedAt: int("overview_generated_at"),
    // A fingerprint of the changes the headline and bullets describe: once the draft's differ,
    // the overview is stale.
    overviewFingerprint: text("overview_fingerprint"),
    // Whether the last attempt failed, the model having given up.
    overviewFailed: int("overview_failed", { mode: "boolean" }).notNull().default(false),
    // A draft with code's last revision (`revisions`), the head of its branch. No foreign key, as
    // revisions reference their draft.
    headRevisionId: text("head_revision_id"),
    // A draft with code's last revision that built and had its Definition Set synced into the
    // draft: the draft reads its own definitions from then on (`definitionsIn`).
    previewedRevisionId: text("previewed_revision_id"),
    // A draft with code being published (`publishes/workflow.ts`): the revision the publish
    // ships, which the review pinned, set from the publish's start until it lands or goes back
    // to the review. While it's set, the draft is in its publishing state, and public reads
    // naming it see Live overlaid with it (`PUBLISHING_DRAFT_HEADER`).
    publishingRevisionId: text("publishing_revision_id"),
    // The publish Workflow's instance, which the publish before it in the project's queue wakes.
    publishInstanceId: text("publish_instance_id"),
    // When the publish was asked for: a project's publishes with code run one at a time, in
    // this order.
    publishRequestedAt: int("publish_requested_at"),
    // When the publish started pointing Live at its own Worker: from then until the batch commits,
    // public reads naming the draft read Live overlaid with it (`access.ts`).
    publishPromotedAt: int("publish_promoted_at"),
    // Why the draft's last publish went back to the review (`PublishAbortReason`), until the
    // next one starts.
    publishAbortReason: text("publish_abort_reason").$type<PublishAbortReason>(),
  },
  (table) => [
    index("drafts_project_idx").on(table.projectId),
    // Each member has one development draft per project (ADR 0006).
    uniqueIndex("drafts_development_idx")
      .on(table.projectId, table.createdBy)
      .where(sql`${table.kind} = 'development'`),
    // Camox keeps one catch-up draft open per project (ADR 0017): `camox` is `CAMOX_ACTOR`.
    uniqueIndex("drafts_catch_up_idx")
      .on(table.projectId)
      .where(sql`${table.kind} = 'regular' and ${table.createdBy} = 'camox'`),
  ],
);

/**
 * The record a regular draft leaves when it's published or deleted, written in the batch
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
