import type { Database } from "../db";
import { runGenerationJob } from "../domains/generated-values/generation";
import { runTranslationJob } from "../domains/translations/job";
import { type AiJob, isTranslationJob } from "./ai-job-queue";

/**
 * Runs a job the AI job scheduler holds: a generated value (ADR 0012) or a translation (ADR
 * 0015). Neither fails: a job whose model gave up settles its request.
 */
export const runAiJob = (db: Database, job: AiJob) =>
  isTranslationJob(job) ? runTranslationJob(db, job) : runGenerationJob(db, job);
