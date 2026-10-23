import type { EdgeCachePurges } from "../src/lib/edge-cache-purges";

// Test files can share an isolate, and with it module instances: keep one log for all of them.
const store = globalThis as { __edgeCachePurgeLog?: string[] };
const log = (store.__edgeCachePurgeLog ??= []);

/** Stands in for the purger Durable Object: records every tag purged. */
export const recordingPurges: EdgeCachePurges = {
  purge(tags) {
    log.push(...tags);
  },
};

/** Whether a tag was purged since `forgetPurged` last forgot it. */
export const purged = (tag: string) => log.includes(tag);

/** Forgets that a tag was purged, to look at the next request alone. */
export const forgetPurged = (tag: string) => {
  for (let index = log.indexOf(tag); index !== -1; index = log.indexOf(tag)) {
    log.splice(index, 1);
  }
};
