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
});
