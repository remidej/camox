import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import type { PatrolJob } from "../../lib/ai-job-queue";
import { scheduleInBackground } from "../../lib/schedule-in-background";
import type { Bindings } from "../../types";
import { projects } from "../projects/schema";
import { writeFindings } from "./findings";
import { leftByAgent, toPatrolDraft } from "./patrol-draft";
import { emailNewFindings } from "./patrol-email";
import { PATROLLERS } from "./patrollers";
import { writeCheck } from "./reports";

// Patrollers' patrols of Live (ADR 0034): Live changes without an edit when other websites move
// or close, so patrollers that check what can go wrong that way patrol every project's Live every
// 6 hours. The cron trigger requests one run per project, of every patroller, so each project's
// patrol runs on its own, and tells members of what's new once.

/** The cron trigger of Live's patrols (wrangler.jsonc): every 6 hours. */
export const LIVE_PATROL_CRON = "0 */6 * * *";

/** The patrollers that patrol Live. */
const patrolling = PATROLLERS.filter((patroller) => patroller.patrol !== undefined);

/** Requests a run of every patroller's patrol of each live project's Live. */
export const requestLivePatrols = Effect.fn("patrol.requestLivePatrols")(function* (db: Database) {
  const rows = yield* Effect.promise(() =>
    db.select({ id: projects.id }).from(projects).where(eq(projects.status, "live")),
  );
  const patrollers = patrolling.map((patroller) => patroller.id);
  for (const { id } of rows) {
    // A patrol that can't be scheduled waits for the next run.
    yield* scheduleInBackground({ kind: "patrol", patrollers, projectId: id }, 0);
  }
});

/**
 * Runs the patrols of a project's Live a job asks for, in the registry's order: each raises what
 * it found on Live and resolves Live's findings it no longer finds, then keeps when it checked.
 * What's new then goes to the Patrol Draft, where Camox's agent fixes it, and members hear of it
 * once its turn on them ended: one email for the whole run.
 */
export const runPatrolJob = Effect.fn("patrol.runPatrolJob")(function* (
  db: Database,
  job: PatrolJob,
) {
  const project = yield* Effect.promise(() =>
    db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, job.projectId), eq(projects.status, "live")))
      .get(),
  );
  // The project was deleted since.
  if (!project) return;
  const scope = { projectId: job.projectId, draftId: null };
  for (const patroller of patrolling.filter(({ id }) => job.patrollers.includes(id))) {
    const patrolled = yield* patroller.patrol!(db, job.projectId);
    yield* writeFindings(db, patroller, scope, patrolled.found, patrolled.checked);
    yield* writeCheck(db, patroller, scope);
  }
  const handed = yield* toPatrolDraft(db, job.projectId);
  if (!handed) return;
  const left = yield* leftByAgent(db, handed);
  yield* emailNewFindings(db, env as Bindings, {
    projectId: job.projectId,
    draftId: handed.draft.id,
    found: handed.found,
    left,
  });
});
