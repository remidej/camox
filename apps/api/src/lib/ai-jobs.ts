import type { Database } from "../db";
import { runOverviewJob } from "../domains/drafts/overview-job";
import { runGenerationJob } from "../domains/generated-values/generation";
import { runTranslationJob } from "../domains/translations/job";
import { type AiJob, isOverviewJob, isTranslationJob } from "./ai-job-queue";

/**
 * Runs a job the AI job scheduler holds: a generated value (ADR 0012), a translation (ADR 0015)
 * or a draft's overview. None fails: a job whose model gave up settles its request.
 */
export const runAiJob = (db: Database, job: AiJob) => {
  if (isOverviewJob(job)) return runOverviewJob(db, job);
  return isTranslationJob(job) ? runTranslationJob(db, job) : runGenerationJob(db, job);
};
