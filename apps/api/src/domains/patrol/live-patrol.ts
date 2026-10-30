import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { AiJobQueue, jobName, type PatrolJob } from "../../lib/ai-job-queue";
import { projects } from "../projects/schema";
import { writeFindings } from "./findings";
import { toPatrolDraft } from "./patrol-draft";
import { PATROLLERS } from "./patrollers";
import { writeCheck } from "./reports";

// Patrollers' patrols of Live (ADR 0034): Live changes without an edit when other websites move
// or close, so patrollers that check what can go wrong that way patrol every project's Live every
// 6 hours. The cron trigger requests one job per project and patroller, so each project's patrol
// runs on its own. The Proofreader's patrol reads Live only when it has something to read there
// (ADR 0034): what a release no draft published wrote, which also requests its job, or all of
// Live on arrival.

/** The cron trigger of Live's patrols (wrangler.jsonc): every 6 hours. */
export const LIVE_PATROL_CRON = "0 */6 * * *";

/** The patrollers that patrol Live. */
const patrolling = PATROLLERS.filter((patroller) => patroller.patrol !== undefined);

/** Requests a patrol of every live project's Live, by each patroller that patrols it. */
export const requestLivePatrols = Effect.fn("patrol.requestLivePatrols")(function* (db: Database) {
  const rows = yield* Effect.promise(() =>
    db.select({ id: projects.id }).from(projects).where(eq(projects.status, "live")),
  );
  const scheduler = yield* AiJobQueue;
  for (const { id } of rows) {
    for (const patroller of patrolling) {
      const job: PatrolJob = { kind: "patrol", patroller: patroller.id, projectId: id };
      // A patrol that can't be scheduled waits for the next run.
      yield* scheduler
        .schedule(job, 0)
        .pipe(
          Effect.catchTag("ScheduleError", (error) =>
            Effect.logError(`[patrol] ${jobName(job)} could not be scheduled`, error.cause),
          ),
        );
    }
  }
});

/**
 * Runs a patroller's patrol of a project's Live: raises what it found on Live and resolves Live's
 * findings it no longer finds, then keeps when it checked. Returns the findings it raised that
 * weren't open on Live already: what's new this run.
 */
export const runPatrolJob = Effect.fn("patrol.runPatrolJob")(function* (
  db: Database,
  job: PatrolJob,
) {
  const patroller = PATROLLERS.find((candidate) => candidate.id === job.patroller);
  const patrol = patroller?.patrol;
  if (!patroller || !patrol) return [];
  const project = yield* Effect.promise(() =>
    db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, job.projectId), eq(projects.status, "live")))
      .get(),
  );
  // The project was deleted since.
  if (!project) return [];
  const scope = { projectId: job.projectId, draftId: null };
  const patrolled = yield* patrol(db, job.projectId);
  // Nothing to read on Live this time: it stays asleep.
  if (!patrolled) return [];
  const { found, checked } = patrolled;
  const opened = yield* writeFindings(db, patroller, scope, found, checked);
  yield* writeCheck(db, patroller, scope);
  // What's new goes to the Patrol Draft, where Camox's agent fixes it.
  yield* toPatrolDraft(db, patroller, job.projectId, opened);
  return opened;
});
