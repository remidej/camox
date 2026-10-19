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

/** The entities a translation job translates: every localized entity (ADR 0015). */
export const TRANSLATED_ENTITIES = [
  "page",
  "block",
  "sharedContent",
  "repeatableItem",
  "record",
] as const;

export type TranslatedEntity = (typeof TRANSLATED_ENTITIES)[number];

/**
 * A job translating a default-locale entity into one locale of a draft (ADR 0015). Jobs are keyed
 * by entity, locale and draft, and debounced like generation jobs. A job translating `defaults`
 * translates the code-owned defaults of a block placed in that locale instead, which has no
 * default-locale source.
 */
export type TranslationJob = {
  kind: "translation";
  entity: TranslatedEntity;
  entityId: string;
  locale: string;
  draftId: string;
  source?: "defaults";
};

/** A job the AI job scheduler runs. */
export type AiJob = GenerationJob | TranslationJob;

export const isTranslationJob = (job: AiJob): job is TranslationJob =>
  "kind" in job && job.kind === "translation";

export class ScheduleError extends Data.TaggedError("ScheduleError")<{ readonly cause: unknown }> {}

/**
 * Runs AI jobs later, debounced by key: scheduling a job whose key is pending replaces it and
 * restarts its delay. Requests and jobs get the Durable Object adapter; tests get a recording
 * one.
 */
export class AiJobQueue extends Context.Service<
  AiJobQueue,
  {
    readonly schedule: (job: AiJob, delayMs: number) => Effect.Effect<void, ScheduleError>;
  }
>()("camox/AiJobQueue") {}

// Durable Object names predate entity names, and stay as they were so a job requested across a
// deploy still replaces the pending one.
const NAME_PARTS = {
  block: ["blocks", "summary"],
  repeatableItem: ["repeatableItems", "summary"],
  page: ["pages", "seo"],
  file: ["files", "fileMetadata"],
} as const satisfies Record<JobEntity, readonly [string, string]>;

/** Names a job: its Durable Object, and its logs. The default locale's jobs keep their names. */
export const jobName = (job: AiJob) => {
  if (isTranslationJob(job)) {
    const name = `translation:${job.entity}:${job.entityId}:${job.locale}:${job.draftId}`;
    return job.source === undefined ? name : `${name}:${job.source}`;
  }
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
export const durableObjectQueue = (namespace: DurableObjectNamespace) =>
  AiJobQueue.of({
    schedule: (job, delayMs) =>
      Effect.tryPromise({
        try: () => {
          const stub = namespace.get(namespace.idFromName(jobName(job))) as SchedulerStub;
          return stub.schedule(job, delayMs);
        },
        catch: (cause) => new ScheduleError({ cause }),
      }),
  });
