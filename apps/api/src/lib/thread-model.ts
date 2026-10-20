import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

import type { Bindings } from "../types";

/** The model a thread's agent runs on, and the models Pi resolves it against. */
export type ThreadModel = {
  models: Models;
  model: { provider: string; id: string };
  thinkingLevel: ModelThinkingLevel;
};

/**
 * Claude Sonnet 5.5 through pi-ai's OpenRouter provider, with the API's OpenRouter key. Integration
 * tests replace this module with pi-ai's fake provider (`test/thread-model.ts`).
 */
export const threadModel = (env: Bindings): ThreadModel => {
  const models = createModels({
    // pi-ai asks for the key under its own name; the API's binding is named differently. Handing
    // it over explicitly also keeps pi-ai from looking for credential files.
    authContext: {
      env: async (name) => (name === "OPENROUTER_API_KEY" ? env.OPEN_ROUTER_API_KEY : undefined),
      fileExists: async () => false,
    },
  });
  models.setProvider(openrouterProvider());
  return {
    models,
    model: { provider: "openrouter", id: "anthropic/claude-sonnet-5.5" },
    thinkingLevel: "low",
  };
};
