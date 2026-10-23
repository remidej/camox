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
// Reached lazily, when called: publishing reads overviews from this module too.
import { camoxContext, type Change, computePreview, requireDraft } from "./publish";
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
  | { status: "ready"; headline: string; bullets: string[] }
  /** The model gave up on the last attempt. */
  | { status: "failed" };

/** The overview of a draft that changes something (`changed`), as its row stores it. */
export function overviewOf(row: DraftRow, changed: boolean): Overview {
  if (!changed || isCatchUpDraft(row)) return { status: "none" };
  if (row.overviewFailed) return { status: "failed" };
  if (row.overviewHeadline !== null) {
    return {
      status: "ready",
      headline: row.overviewHeadline,
      bullets: row.overviewBullets ?? [],
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
  yield* Effect.promise(() =>
    db
      .update(drafts)
      .set({ overviewRequestedAt: requestedAt, overviewFailed: false })
      .where(eq(drafts.id, draftId)),
  );
  yield* record(db, { kind: "overview", projectId: row.projectId, draftId });

  const job: OverviewJob = { kind: "overview", draftId };
  const scheduler = yield* AiJobQueue;
  const background = yield* Background;
  yield* background.run(
    scheduler
      .schedule(job, options.immediately ? 0 : DEBOUNCE_MS)
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

/** Where a change sits, as the model reads it: its page's name and path, or what else holds it. */
function placeOf(change: Change): string {
  const { owner, entity } = change;
  if (entity === "locale") return "Languages";
  if (!owner) return entity === "file" ? "Files" : "Elsewhere";
  if (owner.kind === "layout") return `Layout ${owner.name}`;
  if (owner.kind === "syncedBlock") return `Synced block ${owner.title}`;
  if (owner.kind === "collection") return `Collection ${owner.title}`;
  return owner.nickname ? `${owner.nickname} (${owner.path})` : owner.path;
}

/**
 * Writes a draft's overview from its changes as its review lists them, or nothing once the draft
 * ended, for a catch-up draft, or while it changes nothing. The model already retried a failure:
 * it's recorded, unless the overview was requested again since, and the job doesn't fail.
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
  const { changes } = yield* computePreview(camoxContext(db), draftOf(row));
  if (changes.length === 0) return;
  const model = yield* AiModel;
  const written = yield* Effect.result(
    model.draftOverview({
      draftName: row.name,
      changes: changes.map((change) => ({
        place: placeOf(change),
        label: change.label,
        change: change.change,
        locale: change.locale,
      })),
    }),
  );
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
        overviewGeneratedAt: null,
        overviewFailed: false,
      })
      .where(eq(drafts.id, draftId)),
  ];
}

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
