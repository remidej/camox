import { eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import type { CheckJob } from "../../lib/ai-job-queue";
import { Journal } from "../../lib/journal";
import { scheduleInBackground } from "../../lib/schedule-in-background";
import * as overlay from "../drafts/overlay";
import { fingerprintOfChanges } from "../drafts/overview";
import { drafts } from "../drafts/schema";
import { type Draft, draftOf } from "../drafts/scope";
import { listedChanges } from "../translations/review";
import { type CheckedSubject, isCheckedEntity, writeFindings } from "./findings";
import { type CheckRequest, PATROLLERS, type Patroller, patrollerById } from "./patrollers";
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
 * Requests a patroller's check of a draft for `request`: what it has to read is recorded first,
 * for a patroller that keeps it.
 */
const requestCheckOf = Effect.fn("patrol.requestCheckOf")(function* (
  db: Database,
  patroller: Patroller,
  draft: Draft,
  request: CheckRequest,
  immediately: boolean,
) {
  if (patroller.requests) yield* patroller.requests.request(db, draft, request);
  yield* requestCheck(patroller, draft.id, immediately);
});

/** Requests a patroller's check of one subject of a draft right away: a fix found it changed. */
export const requestRecheck = (
  db: Database,
  patroller: Patroller,
  draft: Draft,
  subject: CheckedSubject,
) => requestCheckOf(db, patroller, draft, [subject], true);

/**
 * Requests every at-publish check of each draft the unit of work wrote content in, for what it
 * wrote: they run once it's been idle for a while, a later write delaying them again.
 */
export const requestChecksOfWrites = Effect.fn("patrol.requestChecksOfWrites")(function* () {
  const { db, changes } = yield* Journal;
  if (!db) return;
  const written = new Map<string, { draft: Draft; subjects: CheckedSubject[] }>();
  const of = (projectId: number, draftId: string) => {
    const known = written.get(draftId) ?? {
      draft: draftOf({ id: draftId, projectId }),
      subjects: [],
    };
    written.set(draftId, known);
    return known;
  };
  for (const change of changes) {
    if (change.kind === "content" && change.draftId !== null) {
      of(change.projectId, change.draftId);
    }
    if (
      change.kind === "localizedWrite" &&
      change.draftId !== null &&
      isCheckedEntity(change.entity)
    ) {
      const { entity, id, locale } = change;
      of(change.projectId, change.draftId).subjects.push({ entity, id, locale });
    }
  }
  for (const { draft, subjects } of written.values()) {
    for (const patroller of checkingAtPublish) {
      yield* requestCheckOf(db, patroller, draft, subjects, false);
    }
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
  for (const patroller of stale) yield* requestCheckOf(db, patroller, draft, "stale", true);
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
  const run = Effect.gen(function* () {
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
  const settle = patroller.requests?.settle(db, draft);
  yield* settle ? Effect.ensuring(run, settle) : run;
});
