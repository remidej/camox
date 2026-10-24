import { beforeAll } from "vite-plus/test";

/**
 * How long importing the Worker's entry may take, under a full parallel run: seconds on its own,
 * since it brings in every Durable Object's and Workflow's modules.
 */
const IMPORT_TIMEOUT_MS = 120_000;

// The pool runs the Worker's Durable Objects from its entry, which it imports on the first call
// to any of them in a test file, inside that call: the first test reaching one (a discard asking
// `DraftCode` whether the draft has code) paid for importing every module the API has, and timed
// out under load. Each file imports it before its tests instead, after its collection, so its
// `vi.mock`s are in place as they would be for the pool's own import.
beforeAll(async () => {
  await import("../src/worker");
}, IMPORT_TIMEOUT_MS);
