import { Context, Effect } from "effect";

import { AiModel } from "../src/lib/ai-model";
import {
  type GenerationJob,
  GenerationScheduler,
  ScheduleError,
} from "../src/lib/generation-scheduler";
import { AiCallError } from "../src/lib/retry-ai-call";

// Stands in for the model and the Durable Object scheduler in every integration test
// (`record-generation.ts`): the model answers what a test scripted, and the scheduler records
// jobs instead of running them.

type Model = AiModel["Service"];
type Method = keyof Model;
type Request<M extends Method> = Parameters<Model[M]>[0];
type Answer<M extends Method> = Effect.Success<ReturnType<Model[M]>>;

/** What the model was asked, in order. */
export type ModelCall = { [M in Method]: { method: M; request: Request<M> } }[Method];

const answers = new Map<Method, (Answer<Method> | AiCallError)[]>();
const calls: ModelCall[] = [];

const answer = <M extends Method>(method: M, request: Request<M>) =>
  Effect.suspend(() => {
    calls.push({ method, request } as ModelCall);
    const next = answers.get(method)?.shift();
    if (next === undefined) {
      return Effect.fail(new AiCallError({ cause: `No ${method} answer scripted` }));
    }
    return next instanceof AiCallError ? Effect.fail(next) : Effect.succeed(next as Answer<M>);
  });

const scriptedModel = AiModel.of({
  summarize: (request) => answer("summarize", request),
  pageSeo: (request) => answer("pageSeo", request),
  imageMetadata: (request) => answer("imageMetadata", request),
});

/**
 * Scripts the model's next answer to `method`, or its failure once it gave up. An unscripted
 * call fails like a model that gave up.
 */
export const answerNext = <M extends Method>(method: M, next: Answer<M> | AiCallError) =>
  answers.set(method, [...(answers.get(method) ?? []), next]);

/** Everything the model was asked since the test started. */
export const modelCalls = (): readonly ModelCall[] => calls;

/** Forgets scripted answers and calls, between tests. */
export const forgetModel = () => {
  answers.clear();
  calls.length = 0;
};

export type ScheduledJob = GenerationJob & { delayMs: number };

const jobs: ScheduledJob[] = [];
let failures = 0;

const recordingScheduler = GenerationScheduler.of({
  schedule: (job, delayMs) =>
    Effect.suspend(() => {
      if (failures > 0) {
        failures--;
        return Effect.fail(new ScheduleError({ cause: "Scheduling failed in a test" }));
      }
      jobs.push({ ...job, delayMs });
      return Effect.void;
    }),
});

/** The jobs scheduled for these entities, in order. */
export const scheduledFor = (...entityIds: string[]): ScheduledJob[] =>
  jobs.filter((job) => entityIds.includes(job.entityId));

/** Forgets the jobs scheduled for these entities, to look at the next ones alone. */
export const forgetScheduled = (...entityIds: string[]) => {
  const kept = jobs.filter((job) => !entityIds.includes(job.entityId));
  jobs.splice(0, jobs.length, ...kept);
};

/** Makes the next scheduling fail, as an unreachable Durable Object would. */
export const failNextSchedule = () => {
  failures++;
};

/** The services `runService` and the job Durable Object provide, in tests. */
export const testGenerationServices = () =>
  Context.make(AiModel, scriptedModel).pipe(Context.add(GenerationScheduler, recordingScheduler));
