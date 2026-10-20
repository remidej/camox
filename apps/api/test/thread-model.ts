import {
  type FauxContentBlock,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type Message,
} from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";

import type { ThreadModel } from "../src/lib/thread-model";

// Stands in for the threads' model in integration tests that `vi.mock` it: pi-ai's
// fake provider answers what a test scripted. Thread Durable Objects run in the tests' isolate, so
// they share this module's provider.

const faux = fauxProvider();

/** The model every thread runs on, in tests. */
export const testThreadModel = (): ThreadModel => {
  const models = createModels();
  models.setProvider(faux.provider);
  const { provider, id } = faux.getModel();
  return { models, model: { provider, id }, thinkingLevel: "off" };
};

/**
 * Scripts the model's next answer, after `thinking` when given. An unscripted call fails like an
 * unreachable model.
 */
export const answerNext = (
  text: string,
  { thinking, stopReason }: { thinking?: string; stopReason?: "stop" | "length" } = {},
) =>
  faux.appendResponses([
    fauxAssistantMessage([...(thinking ? [fauxThinking(thinking)] : []), fauxText(text)], {
      stopReason,
    }),
  ]);

/**
 * Scripts the model's next answer, held until the returned function is called, as a model still
 * writing its answer.
 */
export const holdNextAnswer = (text: string) => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  faux.appendResponses([
    async () => {
      await released;
      return fauxAssistantMessage([fauxText(text)]);
    },
  ]);
  return release;
};

/**
 * Scripts the model's next answer as a code mode call running `code`, after `text` when given:
 * what the agent writes between its tool calls.
 */
export const answerWithScript = (code: string, { text }: { text?: string } = {}) => {
  const content: FauxContentBlock[] = [
    ...(text ? [fauxText(text)] : []),
    fauxToolCall("codemode", { code }),
  ];
  faux.appendResponses([fauxAssistantMessage(content, { stopReason: "toolUse" })]);
};

/** What the model sees when it's called: the tools it's offered, and its last tool's result. */
export type ModelRequest = { offeredTools: string[]; lastToolResult: string };

/** Scripts the model's next answer from what it sees when it's called. */
export const answerFrom = (answer: (request: ModelRequest) => string) =>
  faux.appendResponses([
    (context) => fauxAssistantMessage([fauxText(answer(requestOf(context.messages)))]),
  ]);

const requestOf = (messages: readonly Message[]): ModelRequest => {
  const offered = new Set<string>();
  let lastToolResult = "";
  for (const message of messages) {
    if (message.role === "system") {
      for (const tool of message.toolsAdded ?? []) offered.add(tool.name);
      for (const tool of message.toolsRemoved ?? []) offered.delete(tool.name);
    }
    if (message.role === "toolResult") {
      lastToolResult = message.content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n");
    }
  }
  return { offeredTools: [...offered], lastToolResult };
};

/** How many times threads called the model since the test started. */
export const threadModelCalls = () => faux.state.callCount;

/** Forgets scripted answers and calls, between tests. */
export const forgetThreadModel = () => {
  faux.setResponses([]);
  faux.state.callCount = 0;
};
