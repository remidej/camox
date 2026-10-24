import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { createEnvConformance, createExpectAssertions } from "@earendil-works/pi-durable/testing";
import { describe, expect, it } from "vite-plus/test";

import { MemoryFs } from "../../lib/memory-fs";
import { codeEnv } from "./env";
import { answerEnvCall, remoteEnv } from "./remote-env";

// Pi's own contract for an `ExecutionEnv`, for the operations a code environment supports: its
// file reads. It has no shell and watches nothing, so the cases that run commands or watch files
// don't apply. Pi's cases write the files they read, so the environment under test lets them.
const SUPPORTED = ["binary reader", "directory reader"];

/** Pi's cases an environment `withEnv` gives supports, each given a fresh one. */
const casesFor = (withEnv: (fs: MemoryFs) => ExecutionEnv) =>
  createEnvConformance({
    assertions: createExpectAssertions(expect),
    withEnv: async (use) => {
      const fs = new MemoryFs();
      await fs.promises.mkdir("/work");
      await use(withEnv(fs));
    },
    symlinks: false,
  }).filter(({ name }) => SUPPORTED.some((operation) => name.startsWith(operation)));

const writable = () => undefined;

describe("a code environment", () => {
  const cases = casesFor((fs) => codeEnv(fs, { cwd: "/work", writable }));

  it("is checked against Pi's conformance cases for its reads", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const testCase of cases) it(testCase.name, () => testCase.run(), testCase.timeoutMs);
});

describe("a code environment reached over RPC", () => {
  // RPC carries what structured cloning keeps: no classes, no functions.
  const cases = casesFor((fs) => {
    const there = codeEnv(fs, { cwd: "/work", writable });
    return remoteEnv(
      async (call) => structuredClone(await answerEnvCall(there, structuredClone(call))),
      {
        id: "remote",
        cwd: "/work",
      },
    );
  });

  for (const testCase of cases) it(testCase.name, () => testCase.run(), testCase.timeoutMs);
});
