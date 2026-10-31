import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

import type { Bindings } from "../types";

/** A model, and the thinking level an agent runs it at. */
export type AgentModel = {
  model: { provider: string; id: string };
  thinkingLevel: ModelThinkingLevel;
};

/**
 * The model a thread's agent runs on, the ones its Code Agent and its Artifact Agents run on, set
 * apart so each can change alone, the smaller one its `web_fetch` reads pages with, and the models
 * Pi resolves them against.
 */
export type ThreadModel = AgentModel & {
  models: Models;
  codeAgent: AgentModel;
  artifactAgent: AgentModel;
  pageReader: { provider: string; id: string };
};

/**
 * Claude Opus 5.5 at medium effort, for the thread's agent, its Code Agent and its Artifact Agents
 * alike, and Claude Haiku 5.5 to read pages, through pi-ai's OpenRouter provider with the API's
 * OpenRouter key. Integration tests replace this module with
 * pi-ai's fake provider (`test/thread-model.ts`).
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
    model: { provider: "openrouter", id: "anthropic/claude-opus-5.5" },
    thinkingLevel: "medium",
    codeAgent: {
      model: { provider: "openrouter", id: "anthropic/claude-opus-5.5" },
      thinkingLevel: "medium",
    },
    artifactAgent: {
      model: { provider: "openrouter", id: "anthropic/claude-opus-5.5" },
      thinkingLevel: "medium",
    },
    pageReader: { provider: "openrouter", id: "anthropic/claude-haiku-5.5" },
  };
};
