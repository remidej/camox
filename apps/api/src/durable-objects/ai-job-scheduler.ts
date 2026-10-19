import { DurableObject } from "cloudflare:workers";
import { Effect, Option, Schema } from "effect";

import { createDb } from "../db";
import { aiServices } from "../lib/ai-adapters";
import { type AiJob, entityOfStoredName, jobName, TRANSLATED_ENTITIES } from "../lib/ai-job-queue";
import { runAiJob } from "../lib/ai-jobs";
import { inline } from "../lib/background";
import { announce } from "../lib/invalidation";
import { journaled } from "../lib/journal";
import type { Bindings } from "../types";

const JobEntity = Schema.Literals(["block", "repeatableItem", "page", "file"]);
const TranslatedEntity = Schema.Literals(TRANSLATED_ENTITIES);

const StoredJob = Schema.Union([
  Schema.Struct({
    // Tells a re-scheduled job from the one an in-flight alarm is running.
    id: Schema.String,
    kind: Schema.Literal("translation"),
    entity: TranslatedEntity,
    entityId: Schema.String,
    locale: Schema.String,
    draftId: Schema.String,
  }),
  Schema.Struct({
    id: Schema.String,
    entity: JobEntity,
    entityId: Schema.String,
    draftId: Schema.NullOr(Schema.String),
  }),
  // Jobs stored before jobs named their entity; they drain within seconds of a deploy.
  Schema.Struct({
    id: Schema.String,
    entityTable: Schema.String,
    type: Schema.String,
    entityId: Schema.String,
    draftId: Schema.optional(Schema.NullOr(Schema.String)),
  }),
]);

/** The job stored in a Durable Object, or none when it can't be read. */
const decodeStoredJob = (stored: unknown) =>
  Option.flatMap(
    Schema.decodeUnknownOption(StoredJob)(stored),
    (job): Option.Option<AiJob & { id: string }> => {
      if ("kind" in job) return Option.some(job);
      const draftId = job.draftId ?? null;
      if ("entity" in job) return Option.some({ ...job, draftId });
      const entity = entityOfStoredName(job.entityTable, job.type);
      return entity
        ? Option.some({ id: job.id, entity, entityId: job.entityId, draftId })
        : Option.none();
    },
  );

/**
 * Holds one pending AI job, named by its key (`AiJobQueue`), and runs it when its alarm
 * fires. Scheduling again replaces the job and restarts the delay.
 */
export class AiJobScheduler extends DurableObject<Bindings> {
  async schedule(job: AiJob, delayMs: number): Promise<void> {
    await this.ctx.storage.put("job", { ...job, id: crypto.randomUUID() });
    await this.ctx.storage.setAlarm(Date.now() + delayMs);
  }

  async alarm(): Promise<void> {
    const stored = await this.ctx.storage.get("job");
    if (stored === undefined) return;
    const job = decodeStoredJob(stored);

    if (Option.isSome(job)) {
      // A job that fails settles its request and resolves; only a failure to settle throws, and
      // Cloudflare retries the alarm with backoff. What the job wrote reaches the project's
      // viewers like any write (ADR 0012).
      const run = runAiJob(createDb(this.env.DB), job.value).pipe(
        // The alarm waits for what the job schedules: nothing answers sooner for it.
        Effect.provideContext(aiServices(this.env, inline)),
        Effect.annotateLogs("job", jobName(job.value)),
      );
      await Effect.runPromise(journaled(run, announce));
    } else {
      console.error("[ai-job] unreadable job dropped", stored);
    }

    // A newer job may have been scheduled while this one ran — keep it.
    const current = await this.ctx.storage.get<{ id?: string }>("job");
    if (current?.id === (stored as { id?: string }).id) {
      await this.ctx.storage.delete("job");
    }
  }
}
