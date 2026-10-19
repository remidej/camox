import { afterEach, vi } from "vite-plus/test";

import { forgetAllScheduled, forgetModel } from "./generation";

// Every integration test generates values with a scripted model, and records the jobs it
// schedules rather than reaching OpenRouter and the Durable Objects (`generation.ts`).
vi.mock("../src/lib/generation-adapters", async () => {
  const { testGenerationServices } = await import("./generation");
  return { generationServices: testGenerationServices };
});

afterEach(() => {
  forgetModel();
  forgetAllScheduled();
});
