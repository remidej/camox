import { Effect } from "effect";

import { type AiJob, AiJobQueue, jobName } from "./ai-job-queue";
import { Background } from "./background";

/**
 * Schedules a job in `delayMs`, in the background. One that can't be scheduled is logged: it
 * waits for its next request.
 */
export const scheduleInBackground = Effect.fn("aiJobQueue.scheduleInBackground")(function* (
  job: AiJob,
  delayMs: number,
) {
  const scheduler = yield* AiJobQueue;
  const background = yield* Background;
  yield* background.run(
    scheduler
      .schedule(job, delayMs)
      .pipe(
        Effect.catchTag("ScheduleError", (error) =>
          Effect.logError(`[ai-job] ${jobName(job)} could not be scheduled`, error.cause),
        ),
      ),
  );
});
