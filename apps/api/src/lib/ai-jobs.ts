import { Effect } from "effect";

import type { Database } from "../db";
import { runOverviewJob } from "../domains/drafts/overview-job";
import { publishWhenTranslated } from "../domains/drafts/publish";
import { runGenerationJob } from "../domains/generated-values/generation";
import { runCheckJob } from "../domains/patrol/checks";
import { runPatrolJob } from "../domains/patrol/live-patrol";
import { runTranslationJob } from "../domains/translations/job";
import {
  type AiJob,
  isCheckJob,
  isOverviewJob,
  isPatrolJob,
  isTranslationJob,
} from "./ai-job-queue";

/**
 * Runs a job the AI job scheduler holds: a generated value (ADR 0012), a translation (ADR 0015)
 * a draft's overview, a patroller's check, or its patrol of Live (ADR 0034). None fails: a job whose model gave up settles its request.
 */
export const runAiJob = (db: Database, job: AiJob) => {
  if (isOverviewJob(job)) return runOverviewJob(db, job);
  if (isPatrolJob(job)) return runPatrolJob(db, job).pipe(Effect.asVoid);
  // A catch-up draft Camox publishes once its checks settled too (ADR 0033).
  if (isCheckJob(job)) {
    return runCheckJob(db, job).pipe(Effect.andThen(publishWhenTranslated(db, job.draftId)));
  }
  return isTranslationJob(job) ? runTranslationJob(db, job) : runGenerationJob(db, job);
};
