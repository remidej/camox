import { Effect } from "effect";

// Stands in for D1 failing or lagging as a Live thread moves into the draft its first write
// started, in integration tests that `vi.mock` the threads' service with `interceptMoves`. Thread
// Durable Objects run in the tests' isolate, so they share this module's queue.

type Step = { fail: true } | { held: Promise<void> };

const next: Step[] = [];

/** Makes the next move fail, as if D1 were unreachable. */
export const failNextMove = () => next.push({ fail: true });

/** Holds the next move until the returned function is called. */
export const holdNextMove = () => {
  let release!: () => void;
  next.push({ held: new Promise<void>((resolve) => (release = resolve)) });
  return release;
};

/** Forgets moves queued to fail or wait, between tests. */
export const forgetMoves = () => next.splice(0);

/** `move`, failing or waiting first as the tests queued. */
export function interceptMoves<A extends unknown[], R, E, Q>(
  move: (...args: A) => Effect.Effect<R, E, Q>,
) {
  return (...args: A) =>
    Effect.gen(function* () {
      const step = next.shift();
      if (step && "fail" in step) return yield* Effect.die(new Error("D1 is unreachable"));
      if (step) yield* Effect.promise(() => step.held);
      return yield* move(...args);
    });
}
