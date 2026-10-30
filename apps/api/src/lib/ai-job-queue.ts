import type { PatrollerId } from "@camox/api-contract/patrol";
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
 * by entity, locale, draft and source, and debounced like generation jobs. A job translating
 * `defaults` translates the code-owned defaults of a block placed in that locale instead, or of
 * the shared content a synced block created there, which have no default-locale source. A job
 * merging with `live` merges the draft's localization with Live's, which Live changed since the
 * draft copied it, so it's no longer a conflict (ADR 0016).
 */
export type TranslationJob = {
  kind: "translation";
  entity: TranslatedEntity;
  entityId: string;
  locale: string;
  draftId: string;
  source?: "defaults" | "live";
};

/**
 * A job writing a draft's Draft Overview from its changes, keyed by draft: a newer request
 * replaces a pending one.
 */
export type OverviewJob = { kind: "overview"; draftId: string };

/**
 * A patroller's check of a draft at publish (ADR 0034), keyed by patroller and draft: a newer
 * request replaces a pending one, so it runs once the draft has been idle.
 */
export type CheckJob = { kind: "check"; patroller: PatrollerId; draftId: string };

/**
 * A run of patrollers' patrols of a project's Live content (ADR 0034), keyed by project: the cron
 * trigger requests one of every patroller patrolling Live for every project every 6 hours.
 * Requesting one while another is pending joins it: one run patrols for both, so its new findings
 * are told of once.
 */
export type PatrolJob = { kind: "patrol"; patrollers: readonly PatrollerId[]; projectId: number };

/** A job the AI job scheduler runs. */
export type AiJob = GenerationJob | TranslationJob | OverviewJob | CheckJob | PatrolJob;

export const isTranslationJob = (job: AiJob): job is TranslationJob =>
  "kind" in job && job.kind === "translation";

export const isOverviewJob = (job: AiJob): job is OverviewJob =>
  "kind" in job && job.kind === "overview";

export const isCheckJob = (job: AiJob): job is CheckJob => "kind" in job && job.kind === "check";

export const isPatrolJob = (job: AiJob): job is PatrolJob => "kind" in job && job.kind === "patrol";

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
  if (isOverviewJob(job)) return `overview:${job.draftId}`;
  if (isCheckJob(job)) return `check:${job.patroller}:${job.draftId}`;
  if (isPatrolJob(job)) return `patrol:${job.projectId}`;
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
