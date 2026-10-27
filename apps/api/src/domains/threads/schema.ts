import { int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { projects } from "../projects/schema";

/**
 * Each editor's Live thread in a project: the thread they message the agent in while viewing
 * Live, theirs for good (ADR 0025). The thread itself lives in its own Durable Object, addressed
 * by `threadId`.
 */
export const liveThreads = sqliteTable(
  "live_threads",
  {
    threadId: text("thread_id").primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // The owning editor's id. No foreign key, as for drafts' creators.
    userId: text("user_id").notNull(),
    createdAt: int("created_at").notNull(),
    // Unused since Live threads stopped moving into drafts (ADR 0025): kept while the API before
    // that still runs, and dropped by a later migration.
    continuedIn: text("continued_in"),
  },
  (table) => [uniqueIndex("live_threads_owner_idx").on(table.projectId, table.userId)],
);
