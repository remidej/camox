import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { Models, ModelsSimpleStreamOptions } from "@earendil-works/pi-ai/models";

import type { AiToolKind, AiUsageRecord } from "../ai-usage/schema";

/**
 * What OpenRouter said of a call in its raw stream, which pi-ai leaves out of the message it
 * returns: the provider it routed the call to, and the cost it billed, in millionths of a dollar.
 */
export type Billed = { provider?: string; costMicroUsd?: number };

/** The most calls whose billing is held, waiting to be recorded: the oldest is let go first. */
const HELD_CALLS = 100;

/**
 * Options for one call that note what OpenRouter says of it in its raw stream events, in
 * `calls`, by the call's id, which is the id of the message pi-ai returns (`responseId`). Reads
 * both of OpenRouter's APIs: on its Anthropic one, `message_start` names the call and the
 * provider, and `message_delta` the cost; on its OpenAI one, every chunk names the call and the
 * provider, and the last one the cost.
 */
const observing = (
  calls: Map<string, Billed>,
  options: ModelsSimpleStreamOptions | undefined,
): ModelsSimpleStreamOptions => {
  const billed: Billed = {};
  return {
    ...options,
    onProviderStreamEvent: async (data, model) => {
      const event = (data ?? {}) as {
        type?: string;
        id?: string;
        provider?: string;
        message?: { id?: string; provider?: string };
        usage?: { cost?: number };
      };
      const start = event.type === "message_start" ? event.message : undefined;
      const id = start ? start.id : event.type === "message_delta" ? undefined : event.id;
      const provider = start ? start.provider : event.provider;
      if (typeof provider === "string") billed.provider = provider;
      if (typeof event.usage?.cost === "number") {
        billed.costMicroUsd = Math.round(event.usage.cost * 1_000_000);
      }
      if (typeof id === "string" && !calls.has(id)) {
        calls.set(id, billed);
        if (calls.size > HELD_CALLS) calls.delete(calls.keys().next().value!);
      }
      await options?.onProviderStreamEvent?.(data, model);
    },
  };
};

/**
 * `models`, whose calls also note what OpenRouter says of them in their raw stream, for
 * `billed` to tell once the call is over, then forget. A call never asked about is forgotten
 * once a hundred more were made. `completed` hears of each `completeSimple` call once it's over,
 * with what it was billed.
 */
export const meteredModels = (
  models: Models,
  completed?: (message: AssistantMessage, billed: Billed | undefined) => void,
) => {
  const calls = new Map<string, Billed>();
  const billed = (message: AssistantMessage): Billed | undefined => {
    if (!message.responseId) return undefined;
    const known = calls.get(message.responseId);
    calls.delete(message.responseId);
    return known;
  };
  // pi-ai's models are a class keeping no private fields: the copy calls its methods as its own.
  const metered: Models = Object.create(models);
  metered.streamSimple = (model, context, options) =>
    models.streamSimple(model, context, observing(calls, options));
  metered.completeSimple = async (model, context, options) => {
    const message = await models.completeSimple(model, context, observing(calls, options));
    completed?.(message, billed(message));
    return message;
  };
  return { models: metered, billed };
};

export type MeteredModels = ReturnType<typeof meteredModels>;

/**
 * The columns of a model call's record, from the message pi-ai returned and what OpenRouter
 * billed for it: its cost as billed, or else as pi-ai priced it from its catalog. `startedAt` is
 * when the call was made, and the record's time.
 */
export const callColumns = (
  message: AssistantMessage,
  billed: Billed | undefined,
): Pick<
  AiUsageRecord,
  | "model"
  | "provider"
  | "generationId"
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "reasoningTokens"
  | "costMicroUsd"
  | "costSource"
  | "status"
  | "latencyMs"
  | "createdAt"
> => {
  const { usage } = message;
  const failed = message.stopReason === "error" || message.stopReason === "aborted";
  return {
    model: message.model,
    provider: billed?.provider ?? null,
    generationId: message.responseId ?? null,
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    reasoningTokens: usage.reasoning ?? null,
    costMicroUsd: billed?.costMicroUsd ?? Math.round(usage.cost.total * 1_000_000),
    costSource: billed?.costMicroUsd === undefined ? "estimated" : "billed",
    // Pi retries a failed call on its own: the call after it is recorded as another step.
    status: failed ? "error" : "ok",
    latencyMs: Math.max(0, Date.now() - message.timestamp),
    createdAt: message.timestamp,
  };
};

/** The tools of each kind, by name: any other tool works on content. */
export type ToolKinds = { code: ReadonlySet<string>; web: ReadonlySet<string> };

/**
 * What kind of tools a step called, as its first call's: `reply` when it called none, so its
 * message was its answer.
 */
export const toolKindOf = (calls: readonly string[], kinds: ToolKinds): AiToolKind => {
  const [first] = calls;
  if (first === undefined) return "reply";
  if (kinds.code.has(first)) return "code";
  if (kinds.web.has(first)) return "web";
  return "content";
};

const encoder = new TextEncoder();

/** The size of a tool's result as the model reads it, in bytes: its text and its images' data. */
export const resultBytes = (result: ToolResultMessage) =>
  result.content.reduce(
    (bytes, part) =>
      bytes + (part.type === "text" ? encoder.encode(part.text).length : part.data.length),
    0,
  );
