import type { Database } from "../db";
import { runOverviewJob } from "../domains/drafts/overview-job";
import { runGenerationJob } from "../domains/generated-values/generation";
import { runCheckJob } from "../domains/patrol/checks";
import { runTranslationJob } from "../domains/translations/job";
import { type AiJob, isCheckJob, isOverviewJob, isTranslationJob } from "./ai-job-queue";

/**
 * Runs a job the AI job scheduler holds: a generated value (ADR 0012), a translation (ADR 0015)
 * a draft's overview, or a patroller's check (ADR 0034). None fails: a job whose model gave up settles its request.
 */
export const runAiJob = (db: Database, job: AiJob) => {
  if (isOverviewJob(job)) return runOverviewJob(db, job);
  if (isCheckJob(job)) return runCheckJob(db, job);
  return isTranslationJob(job) ? runTranslationJob(db, job) : runGenerationJob(db, job);
};
