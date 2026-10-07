import { Cause, Data, Effect, Schedule } from "effect";

/** Upper bound for one attempt (image fetch + model call + DB write). */
const ATTEMPT_TIMEOUT = "45 seconds";

/** Two retries after the first attempt, ~2s then ~4s apart (jittered). */
const RETRY_SCHEDULE = Schedule.max([
  Schedule.exponential("2 seconds").pipe(Schedule.jittered),
  Schedule.recurs(2),
]);

export class AiCallError extends Data.TaggedError("AiCallError")<{ readonly cause: unknown }> {}

/**
 * Run an AI-backed job step with a per-attempt timeout and bounded retries.
 * Any failure or defect of an attempt counts as retryable. A timed-out attempt
 * is interrupted, which aborts the controller handed to `run` so the in-flight
 * OpenRouter request is cancelled. Fails with the last error once retries are
 * exhausted.
 */
export function retryAiCall<A, E>(
  label: string,
  run: (abortController: AbortController) => Effect.Effect<A, E>,
) {
  const attempt = Effect.suspend(() => {
    // TanStack AI's `chat()` takes an AbortController rather than a signal.
    const abortController = new AbortController();
    return run(abortController).pipe(
      Effect.onInterrupt(() => Effect.sync(() => abortController.abort())),
      Effect.catchCause((cause) => Effect.fail(new AiCallError({ cause: Cause.squash(cause) }))),
    );
  });

  return attempt.pipe(
    Effect.timeout(ATTEMPT_TIMEOUT),
    Effect.tapError((error) => Effect.logWarning(`[ai-job] ${label} attempt failed`, error)),
    Effect.retry(RETRY_SCHEDULE),
    Effect.tapError((error) => Effect.logError(`[ai-job] ${label} failed after retries`, error)),
  );
}
