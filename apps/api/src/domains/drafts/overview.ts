import { and, eq, lte } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { AiJobQueue, jobName, type OverviewJob } from "../../lib/ai-job-queue";
import { Background } from "../../lib/background";
import { Journal, record } from "../../lib/journal";
import { isCatchUpDraft } from "./catch-up";
import * as overlay from "./overlay";
import { drafts } from "./schema";

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
   * while a new one is written. `name` is the short name AI suggests keeping the draft under,
   * null for an overview written before overviews had one.
   */
  | { status: "ready"; name: string | null; headline: string; bullets: string[]; stale: boolean }
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
 * The fingerprint of a draft's listed changes, or null while it changes nothing: its overview and
 * its patrollers' checks at publish record the one they read.
 */
export const fingerprintOfChanges = (stored: readonly overlay.StoredChange[]) =>
  stored.length > 0
    ? fingerprintOf(
        stored.map(({ entity, row, change }) => ({
          entity,
          id: row.id,
          locale: overlay.localeOfRow(row),
          change,
          updatedAt: row.updatedAt,
        })),
      )
    : Effect.succeed(null);

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
      name: row.overviewName,
      headline: row.overviewHeadline,
      bullets: row.overviewBullets ?? [],
      stale: row.overviewFingerprint !== fingerprint,
    };
  }
  return { status: "pending" };
}

/**
 * Requests a draft's overview, after the debounce or `immediately`: a newer request replaces a
 * pending one. Nothing is requested for an ended draft, a draft that stores nothing, or a
 * catch-up draft, which no one reviews before Camox
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
export const failOverview = (db: Database, projectId: number, draftId: string, since: number) =>
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
 * Clears a draft's overview in the batch that publishes or deletes it.
 */
export function clearStatements(db: Database, draftId: string): overlay.BatchItem[] {
  return [
    db
      .update(drafts)
      .set({
        overviewName: null,
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
