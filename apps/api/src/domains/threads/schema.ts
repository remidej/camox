import { int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { projects } from "../projects/schema";

/**
 * Each editor's current Live thread in a project: the thread they message the agent in while
 * viewing Live. The thread itself lives in its own Durable Object, addressed by `threadId`.
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
  },
  (table) => [uniqueIndex("live_threads_owner_idx").on(table.projectId, table.userId)],
);
