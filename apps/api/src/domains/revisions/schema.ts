import { generateUuidv7 } from "@camox/api-contract/ids";
import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { drafts } from "../drafts/schema";

/** What left a revision: the agent's `build`, the end of its turn, or a merge of `main`. */
export type RevisionSource = "build" | "turn" | "merge";

/**
 * Where a revision's build stands. A revision that isn't built is a commit the end of a turn made
 * anyway, its build having kept failing; one that failed is a merge whose build failed.
 */
export type RevisionBuildStatus = "building" | "built" | "failed" | "notBuilt";

export type RevisionTypeCheckStatus = "pending" | "passed" | "failed";

/**
 * One state of a draft's code (GLOSSARY.md): a commit on the draft's branch, left each time the
 * agent builds its changes, at the end of a turn that changed code, or by a merge of `main`.
 * Each tree is a draft's revision once, so building it again finds the revision.
 */
export const revisions = sqliteTable(
  "revisions",
  {
    id: text().primaryKey().$defaultFn(generateUuidv7),
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    commit: text().notNull(),
    tree: text().notNull(),
    /** The commit's parents: two for a merge of `main`. */
    parents: text({ mode: "json" }).notNull().$type<string[]>(),
    leftBy: text("left_by").notNull().$type<RevisionSource>(),
    /** The thread and its run that left the revision, so undoing a turn can find it. */
    threadId: text("thread_id"),
    runId: text("run_id"),
    buildStatus: text("build_status").notNull().$type<RevisionBuildStatus>(),
    typeCheckStatus: text("type_check_status").notNull().$type<RevisionTypeCheckStatus>(),
    /** The revision's build in `REVISION_BUILDS`, once it built. */
    archiveKey: text("archive_key"),
    /** The `camox` version the revision's `pnpm-lock.yaml` installs, if it has one. */
    camoxVersion: text("camox_version"),
    createdAt: int("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("revisions_draft_tree_idx").on(table.draftId, table.tree),
    index("revisions_draft_idx").on(table.draftId, table.createdAt),
  ],
);
