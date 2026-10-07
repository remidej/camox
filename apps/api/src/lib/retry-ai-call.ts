import { Data, Effect, Schedule } from "effect";

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
 * A timed-out attempt is interrupted, which aborts the controller handed to
 * `run` so the in-flight OpenRouter request is cancelled. Rejects with the
 * last failure once retries are exhausted.
 */
export function retryAiCall<A>(
  label: string,
  run: (abortController: AbortController) => Promise<A>,
): Promise<A> {
  return Effect.tryPromise({
    try: (signal) => run(linkAbortController(signal)),
    catch: (cause) => new AiCallError({ cause }),
  }).pipe(
    Effect.timeout(ATTEMPT_TIMEOUT),
    Effect.tapError((error) => Effect.logWarning(`[ai-job] ${label} attempt failed`, error)),
    Effect.retry(RETRY_SCHEDULE),
    Effect.tapError((error) => Effect.logError(`[ai-job] ${label} failed after retries`, error)),
    Effect.runPromise,
  );
}

// TanStack AI's `chat()` takes an AbortController rather than a signal.
function linkAbortController(signal: AbortSignal) {
  const controller = new AbortController();
  signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  return controller;
}
