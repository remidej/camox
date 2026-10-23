import { vi } from "vite-plus/test";

// Every integration test records edge cache purges rather than sending them to the purger
// Durable Object, which could receive a request after its test file ended.
vi.mock("../src/lib/edge-cache-purges", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/edge-cache-purges")>();
  const { recordingPurges } = await import("./edge-cache-purges");
  return { ...original, edgeCachePurges: recordingPurges };
});
