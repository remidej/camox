/** A queue of operations that run one at a time, each once the one before it ended. */
export type SerialQueue = {
  /** Runs `operation` once the operations queued before it ended, however they ended. */
  run<T>(operation: () => Promise<T>): Promise<T>;
  /** Waits for the operations queued so far to end, never failing. */
  idle(): Promise<void>;
};

export function serialQueue(): SerialQueue {
  let last: Promise<unknown> = Promise.resolve();
  return {
    run(operation) {
      const done = last.then(operation);
      last = done.catch(() => undefined);
      return done;
    },
    idle: () => last.then(() => undefined),
  };
}
