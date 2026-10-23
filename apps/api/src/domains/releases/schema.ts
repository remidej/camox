import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { projects } from "../projects/schema";

export type ReleaseStatus = "running" | "succeeded" | "failed";

/** The release Workflow's steps that run in a sandbox, in order. */
export type ReleaseStep = "install" | "release" | "deploy";

/**
 * One row per release, the Workflow a push to a project's `main` starts. A project serves the
 * `camox` version of its last succeeded release (ADR 0019).
 */
export const releases = sqliteTable(
  "releases",
  {
    id: int().primaryKey({ autoIncrement: true }),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The commit pushed to `main`. */
    commit: text().notNull(),
    /**
     * The commit's Git tree. A succeeded release's is the tree Live serves until the next one,
     * so a push of that tree again releases nothing. Older releases didn't record it.
     */
    tree: text(),
    /** The `camox` version the commit's `pnpm-lock.yaml` installs, if it has one. */
    camoxVersion: text("camox_version"),
    status: text().$type<ReleaseStatus>().notNull(),
    /** The step that gave up, when the release failed. */
    failedStep: text("failed_step").$type<ReleaseStep>(),
    /** The release Workflow's instance, where its logs are. */
    workflowInstanceId: text("workflow_instance_id").notNull(),
    startedAt: int("started_at").notNull(),
    endedAt: int("ended_at"),
  },
  (table) => [
    uniqueIndex("releases_workflow_instance_idx").on(table.workflowInstanceId),
    index("releases_project_idx").on(table.projectId, table.startedAt),
  ],
);
