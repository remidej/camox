import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import type { Database } from "../../db";
import { jobName, type OverviewJob } from "../../lib/ai-job-queue";
import { AiModel } from "../../lib/ai-model";
import { attributedToCamox } from "../../lib/ai-usage";
import { decodeInput } from "../../lib/errors";
import { record } from "../../lib/journal";
import type { ServiceContext } from "../_shared/service-context";
import { isCatchUpDraft } from "./catch-up";
import { failOverview, requestOverview } from "./overview";
import { overviewInput } from "./overview-input";
import { camoxContext, computePreview, requireDraft } from "./publish";
import { drafts } from "./schema";
import { draftOf } from "./scope";

// Writing a draft's Draft Overview from the changes its review lists. Apart from `overview.ts`,
// which publishing reads overviews from, as writing one reads the draft's publish preview.

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
  const written = yield* Effect.result(
    model
      .draftOverview(input)
      .pipe(attributedToCamox(db, { projectId: row.projectId, draftId: row.id, patroller: null })),
  );
  if (written._tag === "Failure") {
    yield* Effect.logError(`[overview] ${jobName(job)} failed`, written.failure.cause);
    return yield* failOverview(db, row.projectId, row.id, startedAt);
  }
  const { name, headline, bullets } = written.success;
  yield* Effect.promise(() =>
    db
      .update(drafts)
      .set({
        overviewName: name,
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
