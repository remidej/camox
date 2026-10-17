import { waitUntil } from "cloudflare:workers";
import { Context, Effect } from "effect";

import { announce } from "./invalidation";
import { journaled, type Journal } from "./journal";

/**
 * Work a unit of work starts without waiting for it, such as reaching another Durable Object.
 * It runs as a unit of work of its own: it records into its own journal and announces what it
 * changed once it succeeded. A failure is logged.
 */
export class Background extends Context.Service<
  Background,
  {
    readonly run: (
      work: Effect.Effect<void, never, Journal>,
    ) => Effect.Effect<void, never, Journal>;
  }
>()("camox/Background") {}

/** Runs the work after a request answered, for as long as the Worker keeps the request alive. */
export const afterResponse = Background.of({
  run: (work) =>
    Effect.sync(() =>
      waitUntil(
        Effect.runPromise(journaled(work, announce)).catch((error: unknown) =>
          console.error("[background] work failed", error),
        ),
      ),
    ),
});

/**
 * Runs the work before going on, in the caller's unit of work: where waiting costs nothing, as in
 * a job's alarm, and in tests.
 */
export const inline = Background.of({ run: (work) => work });
