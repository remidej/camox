import { eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { AiJobQueue, type CheckJob, jobName } from "../../lib/ai-job-queue";
import { Background } from "../../lib/background";
import { Journal } from "../../lib/journal";
import * as overlay from "../drafts/overlay";
import { fingerprintOfChanges } from "../drafts/overview";
import { drafts } from "../drafts/schema";
import { draftOf } from "../drafts/scope";
import { listedChanges } from "../translations/review";
import { writeFindings } from "./findings";
import { PATROLLERS, type Patroller } from "./patrollers";
import { writeCheck } from "./reports";
import { patrolChecks } from "./schema";

// Patrollers' checks of a draft at publish (ADR 0034): each runs once the draft has been idle for
// a while, as a job every write to it requests again, and again right away when its review opens
// if the draft changed since it last checked. Editors never wait on them while they write.

/** How long a draft stays idle before its checks run. */
export const CHECK_IDLE_MS = 90_000;

/** The patrollers that check drafts at publish. */
const checkingAtPublish = PATROLLERS.filter(
  (patroller) => patroller.duty.drafts === "atPublish" && patroller.check !== undefined,
);

/** Requests a patroller's check of a draft, after the idle wait or `immediately`. */
export const requestCheck = Effect.fn("patrol.requestCheck")(function* (
  patroller: Patroller,
  draftId: string,
  immediately: boolean,
) {
  const job: CheckJob = { kind: "check", patroller: patroller.id, draftId };
  const scheduler = yield* AiJobQueue;
  const background = yield* Background;
  // A check that can't be scheduled leaves the last one stale: the review requests it again.
  yield* background.run(
    scheduler
      .schedule(job, immediately ? 0 : CHECK_IDLE_MS)
      .pipe(
        Effect.catchTag("ScheduleError", (error) =>
          Effect.logError(`[check] ${jobName(job)} could not be scheduled`, error.cause),
        ),
      ),
  );
});

/**
 * Requests every at-publish check of each draft the unit of work wrote content in: they run once
 * it's been idle for a while, a later write delaying them again.
 */
export const requestChecksOfWrites = Effect.fn("patrol.requestChecksOfWrites")(function* () {
  const { db, changes } = yield* Journal;
  if (!db) return;
  const written = new Set<string>();
  for (const change of changes) {
    if (change.kind === "content" && change.draftId !== null) written.add(change.draftId);
  }
  for (const draftId of written) {
    for (const patroller of checkingAtPublish) yield* requestCheck(patroller, draftId, false);
  }
});

/** The fingerprint of the changes each patroller's last check of a draft read. */
const checkedFingerprints = Effect.fn("patrol.checkedFingerprints")(function* (
  db: Database,
  draftId: string,
) {
  const rows = yield* Effect.promise(() =>
    db
      .select({ patroller: patrolChecks.patroller, fingerprint: patrolChecks.fingerprint })
      .from(patrolChecks)
      .where(eq(patrolChecks.draftId, draftId)),
  );
  return new Map(rows.map((row) => [row.patroller, row.fingerprint]));
});

/**
 * Requests right away the at-publish checks that last read other changes than the draft's now,
 * `fingerprint`, or never checked it: someone is reviewing it.
 */
export const requestStaleChecks = Effect.fn("patrol.requestStaleChecks")(function* (
  db: Database,
  draftId: string,
  fingerprint: string | null,
) {
  const checked = yield* checkedFingerprints(db, draftId);
  for (const patroller of checkingAtPublish) {
    const last = checked.get(patroller.id);
    if (last === undefined || last !== fingerprint) yield* requestCheck(patroller, draftId, true);
  }
});

/**
 * Runs a patroller's check of a draft: raises what it found and resolves what it no longer
 * finds, then keeps when it checked, and the changes it read. Does nothing once the draft ended.
 */
export const runCheckJob = Effect.fn("patrol.runCheckJob")(function* (db: Database, job: CheckJob) {
  const patroller = PATROLLERS.find((candidate) => candidate.id === job.patroller);
  if (!patroller?.check) return;
  const row = yield* Effect.promise(() =>
    db
      .select({ id: drafts.id, projectId: drafts.projectId })
      .from(drafts)
      .where(eq(drafts.id, job.draftId))
      .get(),
  );
  if (!row) return;
  const draft = draftOf(row);
  const fingerprint = yield* fingerprintOfChanges(
    yield* listedChanges(db, draft, yield* overlay.changesOf(db, draft)),
  );
  const { found, checked } = yield* patroller.check(db, draft);
  const scope = { projectId: row.projectId, draftId: row.id };
  yield* writeFindings(db, patroller, scope, found, checked);
  yield* writeCheck(db, patroller, scope, fingerprint);
});
