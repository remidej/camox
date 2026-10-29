import { Cause, Data, Effect, Schedule } from "effect";

/** Upper bound for one attempt: an image fetch and a model call. */
const ATTEMPT_TIMEOUT = "45 seconds";

/** How many times a call is tried: the first attempt, then two retries. */
const ATTEMPTS = 3;

/** Retries ~2s then ~4s apart (jittered). */
const RETRY_SCHEDULE = Schedule.max([
  Schedule.exponential("2 seconds").pipe(Schedule.jittered),
  Schedule.recurs(ATTEMPTS - 1),
]);

export class AiCallError extends Data.TaggedError("AiCallError")<{ readonly cause: unknown }> {}

/** Which attempt of a call is running: `last` when no retry follows a failure. */
export type AiCallAttempt = { number: number; last: boolean };

/**
 * Run an AI-backed job step with a per-attempt timeout and bounded retries.
 * Any failure or defect of an attempt counts as retryable. A timed-out attempt
 * is interrupted, which aborts the controller handed to `run` so the in-flight
 * OpenRouter request is cancelled. Fails with an `AiCallError` holding the last
 * error, a timeout included, once retries are exhausted.
 */
export function retryAiCall<A, E, R>(
  label: string,
  run: (abortController: AbortController, attempt: AiCallAttempt) => Effect.Effect<A, E, R>,
) {
  // Counted per run of the returned effect, which may run more than once.
  return Effect.suspend(() => {
    let attempts = 0;
    const attempt = Effect.suspend(() => {
      attempts++;
      // TanStack AI's `chat()` takes an AbortController rather than a signal.
      const abortController = new AbortController();
      return run(abortController, { number: attempts, last: attempts === ATTEMPTS }).pipe(
        Effect.onInterrupt(() => Effect.sync(() => abortController.abort())),
        Effect.catchCause((cause) => Effect.fail(new AiCallError({ cause: Cause.squash(cause) }))),
      );
    });

    return attempt.pipe(
      Effect.timeout(ATTEMPT_TIMEOUT),
      Effect.tapError((error) => Effect.logWarning(`[ai-job] ${label} attempt failed`, error)),
      Effect.retry(RETRY_SCHEDULE),
      Effect.mapError((error) =>
        error instanceof AiCallError ? error : new AiCallError({ cause: error }),
      ),
      Effect.tapError((error) => Effect.logError(`[ai-job] ${label} failed after retries`, error)),
    );
  });
}
