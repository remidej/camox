import { and, eq, lte } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import type { Database } from "../../db";
import { AiJobQueue, jobName, type OverviewJob } from "../../lib/ai-job-queue";
import { AiModel } from "../../lib/ai-model";
import { Background } from "../../lib/background";
import { decodeInput } from "../../lib/errors";
import { Journal, record } from "../../lib/journal";
import type { ServiceContext } from "../_shared/service-context";
import { isCatchUpDraft } from "./catch-up";
import * as overlay from "./overlay";
import { overviewInput } from "./overview-input";
// Reached lazily, when called: publishing reads overviews from this module too.
import { camoxContext, computePreview, requireDraft } from "./publish";
import { drafts } from "./schema";
import { draftOf } from "./scope";

// A draft's Draft Overview: a headline and bullets AI writes about its changes, shown at the top
// of its review. It's stored on the draft, beside its name, rather than with generated values,
// which publishing copies to Live: it describes the draft, not its content, so it's never a
// change or a conflict, and goes when the draft ends. Any write to a draft's content requests it.

type DraftRow = typeof drafts.$inferSelect;

/**
 * How long a request waits for more edits before writing the overview: longer than a page's SEO
 * waits, so the summaries naming the draft's blocks usually settle first.
 */
const DEBOUNCE_MS = 30_000;

/** A draft's overview as its review shows it. */
export type Overview =
  /** Nothing to describe: the draft is empty, or Camox opened it to catch translations up. */
  | { status: "none" }
  /** Requested, with nothing written yet. */
  | { status: "pending" }
  /**
   * Written. A `stale` one describes an older version of the draft's changes: it's still shown
   * while a new one is written.
   */
  | { status: "ready"; headline: string; bullets: string[]; stale: boolean }
  /** The model gave up on the last attempt. */
  | { status: "failed" };

/** What identifies one of a draft's changes, for their fingerprint. */
export type FingerprintedChange = {
  entity: string;
  id: string;
  locale: string | null;
  change: string;
  /** When the draft's row was last written. */
  updatedAt: number;
};

/**
 * A fingerprint of a draft's changes: it differs once any of them is added, dropped, or written
 * again. The overview records the one of the changes it describes.
 */
export const fingerprintOf = Effect.fn("drafts.overviewFingerprint")(function* (
  changes: FingerprintedChange[],
) {
  const lines = changes
    .map(({ entity, id, locale, change, updatedAt }) =>
      JSON.stringify([entity, id, locale, change, updatedAt]),
    )
    .sort();
  const digest = yield* Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(lines.join("\n"))),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
});

/**
 * A draft's overview as its row stores it, given the fingerprint of the draft's changes (null
 * while it changes nothing).
 */
export function overviewOf(row: DraftRow, fingerprint: string | null): Overview {
  if (fingerprint === null || isCatchUpDraft(row)) return { status: "none" };
  if (row.overviewFailed) return { status: "failed" };
  if (row.overviewHeadline !== null) {
    return {
      status: "ready",
      headline: row.overviewHeadline,
      bullets: row.overviewBullets ?? [],
      stale: row.overviewFingerprint !== fingerprint,
    };
  }
  return { status: "pending" };
}

/**
 * Requests a draft's overview, after the debounce or `immediately`: a newer request replaces a
 * pending one. Nothing is requested for an ended draft, a draft that stores nothing, as a
 * development draft publishing emptied, or a catch-up draft, which no one reviews before Camox
 * publishes it. Scheduling doesn't hold up the request; one that can't be scheduled fails the
 * overview, for Retry to request again.
 */
export const requestOverview = Effect.fn("drafts.requestOverview")(function* (
  db: Database,
  draftId: string,
  options: { immediately?: boolean } = {},
) {
  const row = yield* Effect.promise(() =>
    db
      .select()
      .from(drafts)
      .where(and(eq(drafts.id, draftId), overlay.storesAnything({ id: draftId })))
      .get(),
  );
  if (!row || isCatchUpDraft(row)) return;
  const requestedAt = Date.now();
  const delayMs = options.immediately ? 0 : DEBOUNCE_MS;
  yield* Effect.promise(() =>
    db
      .update(drafts)
      .set({
        overviewRequestedAt: requestedAt,
        overviewDueAt: requestedAt + delayMs,
        overviewFailed: false,
      })
      .where(eq(drafts.id, draftId)),
  );
  yield* record(db, { kind: "overview", projectId: row.projectId, draftId });

  const job: OverviewJob = { kind: "overview", draftId };
  const scheduler = yield* AiJobQueue;
  const background = yield* Background;
  yield* background.run(
    scheduler
      .schedule(job, delayMs)
      .pipe(
        Effect.catchTag("ScheduleError", (error) =>
          Effect.logError(`[overview] ${jobName(job)} could not be scheduled`, error.cause).pipe(
            Effect.andThen(failOverview(db, row.projectId, draftId, requestedAt)),
          ),
        ),
      ),
  );
});

/** Records that the overview requested by `since` failed, unless another was requested since. */
const failOverview = (db: Database, projectId: number, draftId: string, since: number) =>
  Effect.gen(function* () {
    const failed = yield* Effect.promise(() =>
      db
        .update(drafts)
        .set({ overviewFailed: true })
        .where(and(eq(drafts.id, draftId), lte(drafts.overviewRequestedAt, since))),
    );
    if (failed.meta.changes > 0) yield* record(db, { kind: "overview", projectId, draftId });
  });

/**
 * Writes a draft's overview from its changes, field by field (`overviewInput`), or nothing once
 * the draft ended, for a catch-up draft, or while it changes nothing. The model already retried a
 * failure: it's recorded, unless the overview was requested again since, and the job doesn't fail.
 */
export const runOverviewJob = Effect.fn("drafts.runOverviewJob")(function* (
  db: Database,
  job: OverviewJob,
) {
  const row = yield* Effect.promise(() =>
    db.select().from(drafts).where(eq(drafts.id, job.draftId)).get(),
  );
  if (!row || isCatchUpDraft(row)) return;
  const startedAt = Date.now();
  const ctx = camoxContext(db);
  const scope = draftOf(row);
  const { changes, defaultLocale, fingerprint } = yield* computePreview(ctx, scope);
  if (changes.length === 0) return;
  const input = yield* overviewInput(ctx, scope, row.name, changes, defaultLocale);
  const model = yield* AiModel;
  const written = yield* Effect.result(model.draftOverview(input));
  if (written._tag === "Failure") {
    yield* Effect.logError(`[overview] ${jobName(job)} failed`, written.failure.cause);
    return yield* failOverview(db, row.projectId, row.id, startedAt);
  }
  const { headline, bullets } = written.success;
  yield* Effect.promise(() =>
    db
      .update(drafts)
      .set({
        overviewHeadline: headline,
        overviewBullets: bullets,
        overviewGeneratedAt: Date.now(),
        overviewFingerprint: fingerprint,
        overviewFailed: false,
      })
      .where(eq(drafts.id, row.id)),
  );
  yield* record(db, { kind: "overview", projectId: row.projectId, draftId: row.id });
});

/**
 * Clears a draft's overview in the batch that publishes or discards it: a regular draft goes with
 * its overview, and a development draft, emptied, describes nothing until it changes again.
 */
export function clearStatements(db: Database, draftId: string): overlay.BatchItem[] {
  return [
    db
      .update(drafts)
      .set({
        overviewHeadline: null,
        overviewBullets: null,
        overviewRequestedAt: null,
        overviewDueAt: null,
        overviewGeneratedAt: null,
        overviewFingerprint: null,
        overviewFailed: false,
      })
      .where(eq(drafts.id, draftId)),
  ];
}

/**
 * Requests a draft's overview right away when its review reads it outdated: stale, or pending
 * without ever having been requested, as for a draft written before overviews existed. A pending
 * one that was requested waits for its debounce. Nothing is requested while a request is already
 * due and its job hasn't written yet, so reading the review again doesn't request it again. A
 * stale one written since its last request is requested again: its draft changed through a write
 * that requests nothing, such as a translation merging into a hand-edited localization.
 */
export const requestIfOutdated = Effect.fn("drafts.requestOverviewIfOutdated")(function* (
  db: Database,
  draftId: string,
  overview: Overview,
) {
  const stale = overview.status === "ready" && overview.stale;
  if (!stale && overview.status !== "pending") return;
  const row = yield* Effect.promise(() =>
    db
      .select({
        requestedAt: drafts.overviewRequestedAt,
        dueAt: drafts.overviewDueAt,
        generatedAt: drafts.overviewGeneratedAt,
      })
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .get(),
  );
  if (!row) return;
  if (!stale && row.requestedAt !== null) return;
  const writtenSinceRequested =
    row.generatedAt !== null && row.requestedAt !== null && row.generatedAt >= row.requestedAt;
  const awaitingDueJob = row.dueAt !== null && row.dueAt <= Date.now() && !writtenSinceRequested;
  if (awaitingDueJob) return;
  yield* requestOverview(db, draftId, { immediately: true });
});

export const retryOverviewInput = z.object({ projectId: z.number() });

/** Requests the overview of the request's draft right away, as Retry does once it failed. */
export const retryOverview = Effect.fn("drafts.retryOverview")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof retryOverviewInput>,
) {
  const { projectId } = yield* decodeInput(retryOverviewInput, rawInput);
  const draft = yield* requireDraft(ctx, projectId);
  yield* requestOverview(ctx.db, draft.id, { immediately: true });
});

/**
 * Requests the overview of every draft a unit of work wrote content in, reverts included. Runs
 * once the work succeeded, with its journal: the overlay records every content write.
 */
export const requestOverviewsOfWrites = Effect.fn("drafts.requestOverviewsOfWrites")(function* () {
  const { db, changes } = yield* Journal;
  if (!db) return;
  const written = new Set<string>();
  for (const change of changes) {
    if (change.kind === "content" && change.draftId !== null) written.add(change.draftId);
  }
  for (const draftId of written) yield* requestOverview(db, draftId);
});
