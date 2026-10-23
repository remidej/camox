import { createEnvConformance, createExpectAssertions } from "@earendil-works/pi-durable/testing";
import { describe, expect, it } from "vite-plus/test";

import { MemoryFs } from "../../lib/memory-fs";
import { codeEnv } from "./env";

// Pi's own contract for an `ExecutionEnv`, for the operations a code environment supports: its
// file reads. It has no shell and watches nothing, so the cases that run commands or watch files
// don't apply. Pi's cases write the files they read, so the environment under test lets them.
const SUPPORTED = ["binary reader", "directory reader"];

const cases = createEnvConformance({
  assertions: createExpectAssertions(expect),
  withEnv: async (use) => {
    const fs = new MemoryFs();
    await fs.promises.mkdir("/work");
    await use(codeEnv(fs, { cwd: "/work", writable: () => undefined }));
  },
  symlinks: false,
}).filter(({ name }) => SUPPORTED.some((operation) => name.startsWith(operation)));

describe("a code environment", () => {
  it("is checked against Pi's conformance cases for its reads", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const testCase of cases) it(testCase.name, () => testCase.run(), testCase.timeoutMs);
});
