import { eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import type { CheckJob } from "../../lib/ai-job-queue";
import { Journal } from "../../lib/journal";
import { scheduleInBackground } from "../../lib/schedule-in-background";
import * as overlay from "../drafts/overlay";
import { fingerprintOfChanges } from "../drafts/overview";
import { drafts } from "../drafts/schema";
import { draftOf } from "../drafts/scope";
import { listedChanges } from "../translations/review";
import { isCheckedEntity, writeFindings } from "./findings";
import { PATROLLERS, type Patroller, patrollerById } from "./patrollers";
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

/** Requests a patroller's check of a draft, after the idle wait, `immediately`, or in `delayMs`. */
export const requestCheck = Effect.fn("patrol.requestCheck")(function* (
  patroller: Patroller,
  draftId: string,
  immediately: boolean | { delayMs: number },
) {
  const delayMs =
    typeof immediately === "object" ? immediately.delayMs : immediately ? 0 : CHECK_IDLE_MS;
  const job: CheckJob = { kind: "check", patroller: patroller.id, draftId };
  // A check that can't be scheduled leaves the last one stale: the review requests it again.
  yield* scheduleInBackground(job, delayMs);
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
    const writesContent =
      change.kind === "content" ||
      (change.kind === "localizedWrite" && isCheckedEntity(change.entity));
    if (writesContent && change.draftId !== null) written.add(change.draftId);
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
 * The at-publish checks that last read other changes than the draft's now, `fingerprint`, or
 * never checked it: stale, or still running. Publishing waits for them (ADR 0033).
 */
export const staleChecks = Effect.fn("patrol.staleChecks")(function* (
  db: Database,
  draftId: string,
  fingerprint: string | null,
) {
  const checked = yield* checkedFingerprints(db, draftId);
  return checkingAtPublish.filter((patroller) => {
    const last = checked.get(patroller.id);
    return last === undefined || last !== fingerprint;
  });
});

/** Requests right away the draft's stale at-publish checks: someone is reviewing it. */
export const requestStaleChecks = Effect.fn("patrol.requestStaleChecks")(function* (
  db: Database,
  draftId: string,
  fingerprint: string | null,
) {
  const stale = yield* staleChecks(db, draftId, fingerprint);
  if (stale.length === 0) return;
  const draft = yield* draftById(db, draftId);
  if (!draft) return;
  for (const patroller of stale) yield* requestCheck(patroller, draft.id, true);
});

/** A draft, by id, until it ended. */
const draftById = Effect.fn("patrol.draftById")(function* (db: Database, draftId: string) {
  const row = yield* Effect.promise(() =>
    db
      .select({ id: drafts.id, projectId: drafts.projectId })
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .get(),
  );
  return row && draftOf(row);
});

/**
 * Runs a patroller's check of a draft: raises what it found and resolves what it no longer
 * finds, then keeps when it checked, and the changes it read. Does nothing once the draft ended.
 */
export const runCheckJob = Effect.fn("patrol.runCheckJob")(function* (db: Database, job: CheckJob) {
  const patroller = patrollerById(job.patroller);
  const { check } = patroller;
  if (!check) return;
  const draft = yield* draftById(db, job.draftId);
  if (!draft) return;
  yield* Effect.gen(function* () {
    const fingerprint = yield* fingerprintOfChanges(
      yield* listedChanges(db, draft, yield* overlay.changesOf(db, draft)),
    );
    const { found, checked, complete = true, recheckInMs } = yield* check(db, draft);
    const scope = { projectId: draft.projectId, draftId: draft.id };
    yield* writeFindings(db, patroller, scope, found, checked);
    // An incomplete check read no changes in full, and an unsettled one isn't done reading them:
    // either way it isn't up to date.
    const settled = complete && recheckInMs === undefined;
    yield* writeCheck(db, patroller, scope, settled ? fingerprint : null);
    if (recheckInMs !== undefined) {
      yield* requestCheck(patroller, draft.id, { delayMs: recheckInMs });
    }
  });
});
