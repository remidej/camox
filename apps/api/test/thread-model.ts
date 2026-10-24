import {
  type AssistantMessage,
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
 * writing its answer. Stopping the run lets go of it too.
 */
export const holdNextAnswer = (text: string) => hold(fauxAssistantMessage([fauxText(text)]));

/**
 * Scripts the model's next answer as a code mode call running `code`, held until the returned
 * function is called.
 */
export const holdNextScript = (code: string) =>
  hold(fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }));

/**
 * Scripts the model's next answer as a call of the tool `name`, outside code mode, held until the
 * returned function is called.
 */
export const holdNextToolCall = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  hold(fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }));

const hold = (message: AssistantMessage) => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  faux.appendResponses([
    async (_context, options) => {
      // Once let go, the fake provider answers an aborted call as aborted.
      await Promise.race([
        released,
        new Promise((resolve) => options?.signal?.addEventListener("abort", resolve)),
      ]);
      return message;
    },
  ]);
  return release;
};

/**
 * Scripts the model's next answer as a failure: `retryable` like an overloaded provider, which Pi
 * retries, or otherwise like a request the provider turned down, which ends the turn.
 */
export const failNext = ({ retryable = false }: { retryable?: boolean } = {}) =>
  faux.appendResponses([
    fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: retryable ? "Provider overloaded" : "Invalid request",
    }),
  ]);

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

/** Scripts the model's next answer as a call of the tool `name`, outside code mode. */
export const answerWithToolCall = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  faux.appendResponses([
    fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
  ]);

/**
 * Scripts the model's next answer as a call of the tool `name`, outside code mode, with the
 * arguments `args` gives from what the model sees then, such as its last tool's result.
 */
export const answerWithToolCallFrom = (
  name: string,
  args: (request: ModelRequest) => Parameters<typeof fauxToolCall>[1],
) =>
  faux.appendResponses([
    (context) =>
      fauxAssistantMessage([fauxToolCall(name, args(requestOf(context.messages)))], {
        stopReason: "toolUse",
      }),
  ]);

/**
 * What the model sees when it's called: the editors' messages, the tools it's offered, its last
 * tool's result, and the output of the last script it ran, without code mode's header.
 */
export type ModelRequest = {
  editorMessages: string[];
  offeredTools: string[];
  lastToolResult: string;
  scriptOutput: string;
};

/** Scripts the model's next answer from what it sees when it's called. */
export const answerFrom = (answer: (request: ModelRequest) => string) =>
  faux.appendResponses([
    (context) => fauxAssistantMessage([fauxText(answer(requestOf(context.messages)))]),
  ]);

const requestOf = (messages: readonly Message[]): ModelRequest => {
  const editorMessages: string[] = [];
  const offered = new Set<string>();
  let lastToolResult = "";
  let scriptOutput = "";
  for (const message of messages) {
    if (message.role === "user") {
      const { content } = message;
      editorMessages.push(
        typeof content === "string"
          ? content
          : content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
      );
    }
    if (message.role === "system") {
      for (const tool of message.toolsAdded ?? []) offered.add(tool.name);
      for (const tool of message.toolsRemoved ?? []) offered.delete(tool.name);
    }
    if (message.role === "toolResult") {
      const texts = message.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
      lastToolResult = texts.join("\n");
      // Code mode's result starts with a header of its own (outcome, wall time), then the output.
      if (message.toolName === "codemode") scriptOutput = texts.slice(1).join("\n");
    }
  }
  return { editorMessages, offeredTools: [...offered], lastToolResult, scriptOutput };
};

/** How many times threads called the model since the test started. */
export const threadModelCalls = () => faux.state.callCount;

/** Forgets scripted answers and calls, between tests. */
export const forgetThreadModel = () => {
  faux.setResponses([]);
  faux.state.callCount = 0;
};
