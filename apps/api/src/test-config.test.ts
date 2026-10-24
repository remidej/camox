import { describe, expect, it } from "vite-plus/test";

import config from "../vite.config";

// A worker running a second integration test file died on a message too large for workerd (see
// `fsModuleCache` in vite.config.ts) once the API imported `@cloudflare/sandbox`. Any module the
// API adds can do it again while the module cache is on.
describe("the integration tests' configuration", () => {
  it("fetches each module in its own message, whatever the size of the API's modules", () => {
    const projects = (config.test?.projects ?? []) as { test?: Record<string, unknown> }[];
    const integration = projects.find((project) => project.test?.name === "integration");
    expect(integration?.test?.fsModuleCache).toBe(false);
  });

  // The pool imports the Worker's entry on a file's first Durable Object call, inside it: the
  // test making that call (any discard) timed out under a full parallel run.
  it("imports the Worker's entry before each file's tests, not in its first Durable Object call", () => {
    const projects = (config.test?.projects ?? []) as { test?: Record<string, unknown> }[];
    const integration = projects.find((project) => project.test?.name === "integration");
    expect(integration?.test?.setupFiles).toContain("./test/import-worker.ts");
  });
});
