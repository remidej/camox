import { Context, Effect } from "effect";

import { type AiJob, AiJobQueue, ScheduleError } from "../src/lib/ai-job-queue";
import { AiModel } from "../src/lib/ai-model";
import { Background, inline } from "../src/lib/background";
import { AiCallError } from "../src/lib/retry-ai-call";

// Stands in for the model and the Durable Object scheduler in every integration test
// (`record-generation.ts`): the model answers what a test scripted, and the scheduler records
// jobs instead of running them.

type Model = AiModel["Service"];
type Method = keyof Model;
type Request<M extends Method> = Parameters<Model[M]>[0];
type Answer<M extends Method> = Effect.Success<ReturnType<Model[M]>>;
type Answered<M extends Method> = Answer<M> | AiCallError;
/** Answers a call, or waits on something first, as a test acting while the model runs does. */
type Answerer<M extends Method> = (request: Request<M>) => Answered<M> | Promise<Answered<M>>;

/** What the model was asked, in order. */
export type ModelCall = { [M in Method]: { method: M; request: Request<M> } }[Method];

const answers = new Map<Method, (Answer<Method> | AiCallError)[]>();
const standing = new Map<Method, Answerer<Method>>();
const calls: ModelCall[] = [];

const answer = <M extends Method>(method: M, request: Request<M>) =>
  Effect.suspend(() => {
    calls.push({ method, request } as ModelCall);
    const next = answers.get(method)?.shift();
    if (next === undefined) {
      const answerer = standing.get(method) as Answerer<M> | undefined;
      const unscripted = new AiCallError({ cause: `No ${method} answer scripted` });
      return Effect.promise(async () => answerer?.(request)).pipe(
        Effect.flatMap((answered) =>
          answered === undefined || answered instanceof AiCallError
            ? Effect.fail(answered ?? unscripted)
            : Effect.succeed(answered),
        ),
      );
    }
    return next instanceof AiCallError ? Effect.fail(next) : Effect.succeed(next as Answer<M>);
  });

const scriptedModel = AiModel.of({
  summarize: (request) => answer("summarize", request),
  pageSeo: (request) => answer("pageSeo", request),
  imageMetadata: (request) => answer("imageMetadata", request),
  translate: (request) => answer("translate", request),
  merge: (request) => answer("merge", request),
});

/**
 * Scripts the model's next answer to `method`, or its failure once it gave up. An unscripted
 * call fails like a model that gave up.
 */
export const answerNext = <M extends Method>(method: M, next: Answer<M> | AiCallError) =>
  answers.set(method, [...(answers.get(method) ?? []), next]);

/** Scripts how the model answers every call to `method` that no `answerNext` answers. */
export const answerEvery = <M extends Method>(method: M, answerer: Answerer<M>) =>
  standing.set(method, answerer as unknown as Answerer<Method>);

/** Everything the model was asked since the test started. */
export const modelCalls = (): readonly ModelCall[] => calls;

/** Forgets scripted answers and calls, between tests. */
export const forgetModel = () => {
  answers.clear();
  standing.clear();
  calls.length = 0;
};

export type ScheduledJob = AiJob & { delayMs: number };

const jobs: ScheduledJob[] = [];
let failures = 0;

const recordingScheduler = AiJobQueue.of({
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

/** Every job scheduled and not forgotten, in order. */
export const scheduled = (): readonly ScheduledJob[] => [...jobs];

/** Forgets the jobs scheduled for these entities, to look at the next ones alone. */
export const forgetScheduled = (...entityIds: string[]) => {
  const kept = jobs.filter((job) => !entityIds.includes(job.entityId));
  jobs.splice(0, jobs.length, ...kept);
};

/** Forgets every scheduled job, between tests. */
export const forgetAllScheduled = () => {
  jobs.length = 0;
  failures = 0;
};

/** Makes the next scheduling fail, as an unreachable Durable Object would. */
export const failNextSchedule = () => {
  failures++;
};

/** The services `runService` and the job Durable Object provide, in tests. */
export const testAiServices = () =>
  Context.make(AiModel, scriptedModel).pipe(
    Context.add(AiJobQueue, recordingScheduler),
    // Scheduling runs before the request answers, so tests see the jobs it scheduled.
    Context.add(Background, inline),
  );
