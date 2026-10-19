import { Context, Data, Effect } from "effect";

import type { AiJobScheduler } from "../durable-objects/ai-job-scheduler";

/** The entities a generation job runs on: a synced block's summary is generated through a placement. */
export type JobEntity = "block" | "repeatableItem" | "page" | "file";

/**
 * A job generating an entity's value in Live (`draftId` null) or in one draft (ADR 0012), in a
 * locale other than the default one, named by its tag, or without one in the default locale.
 * Jobs are keyed by all four: a newer job of the same key replaces a pending one. Summaries are
 * only generated in the default locale.
 */
export type GenerationJob = {
  entity: JobEntity;
  entityId: string;
  draftId: string | null;
  locale?: string;
};

export class ScheduleError extends Data.TaggedError("ScheduleError")<{ readonly cause: unknown }> {}

/**
 * Runs generation jobs later, debounced by key: scheduling a job whose key is pending replaces
 * it and restarts its delay. Requests and jobs get the Durable Object adapter; tests get a
 * recording one.
 */
export class GenerationScheduler extends Context.Service<
  GenerationScheduler,
  {
    readonly schedule: (job: GenerationJob, delayMs: number) => Effect.Effect<void, ScheduleError>;
  }
>()("camox/GenerationScheduler") {}

// Durable Object names predate entity names, and stay as they were so a job requested across a
// deploy still replaces the pending one.
const NAME_PARTS = {
  block: ["blocks", "summary"],
  repeatableItem: ["repeatableItems", "summary"],
  page: ["pages", "seo"],
  file: ["files", "fileMetadata"],
} as const satisfies Record<JobEntity, readonly [string, string]>;

/** Names a job: its Durable Object, and its logs. The default locale's jobs keep their names. */
export const jobName = (job: GenerationJob) => {
  const [table, type] = NAME_PARTS[job.entity];
  const name = `${table}:${job.entityId}:${type}:${job.draftId ?? "live"}`;
  return job.locale === undefined ? name : `${name}:${job.locale}`;
};

/** The entity of a job stored under its former table and type names. */
export const entityOfStoredName = (table: string, type: string) =>
  (Object.keys(NAME_PARTS) as JobEntity[]).find(
    (entity) => NAME_PARTS[entity][0] === table && NAME_PARTS[entity][1] === type,
  );

type SchedulerStub = DurableObjectStub & Pick<AiJobScheduler, "schedule">;

/** One Durable Object per job key, holding the pending job and its alarm. */
export const durableObjectScheduler = (namespace: DurableObjectNamespace) =>
  GenerationScheduler.of({
    schedule: (job, delayMs) =>
      Effect.tryPromise({
        try: () => {
          const stub = namespace.get(namespace.idFromName(jobName(job))) as SchedulerStub;
          return stub.schedule(job, delayMs);
        },
        catch: (cause) => new ScheduleError({ cause }),
      }),
  });
