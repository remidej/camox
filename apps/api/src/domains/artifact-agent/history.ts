import type { AssistantMessage, Message, ToolResultMessage } from "@earendil-works/pi-ai";

import { resolvePath } from "../code/env";
import { ARTIFACT_PATH } from "./env";

/** How long the model's provider keeps a prompt cached after its last use: 5 minutes. */
export const PROMPT_CACHE_TTL_MS = 5 * 60_000;

/** What replaces an earlier copy of the artifact's source the history leaves out. */
export const LEFT_OUT_SOURCE = `(An earlier version of ${ARTIFACT_PATH}, left out: read the file for its current source.)`;

/** What replaces a screenshot the history leaves out. */
export const LEFT_OUT_IMAGE = "(A screenshot, left out.)";

/**
 * An Artifact Agent's history as its model reads it, from its conversation's `messages`: the
 * messages older than `prunedBefore` leave out the copies of the artifact's source that `write`
 * and `read` carry, and screenshots, which are stale once the source changed. Requests, answers
 * and edits stay.
 *
 * A request starting a turn once the cached prompt expired, more than `PROMPT_CACHE_TTL_MS` after
 * the agent's last call, moves `prunedBefore` to that request: the whole history is sent again
 * anyway, so it's sent smaller. Any other request keeps `prunedBefore`, and the history it sends
 * starts as the previous one did, so the provider reads it from its cache.
 */
export const artifactHistory = (
  messages: readonly Message[],
  { prunedBefore, now }: { prunedBefore: number | undefined; now: number },
): { messages: readonly Message[]; prunedBefore: number | undefined } => {
  const latest = messages.at(-1);
  const lastCall = messages.findLast((message) => message.role === "assistant")?.timestamp;
  const cold =
    latest?.role === "user" && lastCall !== undefined && now - lastCall > PROMPT_CACHE_TTL_MS;
  const before = cold ? latest.timestamp : prunedBefore;
  if (before === undefined) return { messages, prunedBefore };

  const sourceCalls = new Set<string>();
  const pruned = messages.map((message): Message => {
    if (message.timestamp >= before) return message;
    if (message.role === "assistant") return withoutWrittenSources(message, sourceCalls);
    if (message.role === "toolResult") return withoutCopies(message, sourceCalls);
    return message;
  });
  return { messages: pruned, prunedBefore: before };
};

const isSource = (path: unknown) =>
  typeof path === "string" && resolvePath("/", path) === ARTIFACT_PATH;

/** `message` without the sources its `write` calls carry; `sourceCalls` learns its source calls. */
const withoutWrittenSources = (
  message: AssistantMessage,
  sourceCalls: Set<string>,
): AssistantMessage => ({
  ...message,
  content: message.content.map((part) => {
    if (part.type !== "toolCall" || !isSource(part.arguments.path)) return part;
    sourceCalls.add(part.id);
    if (part.name !== "write") return part;
    return { ...part, arguments: { ...part.arguments, content: LEFT_OUT_SOURCE } };
  }),
});

/** `result` without its screenshots, and without the source a `read` of it returned. */
const withoutCopies = (result: ToolResultMessage, sourceCalls: Set<string>): ToolResultMessage => {
  if (result.toolName === "read" && sourceCalls.has(result.toolCallId)) {
    return { ...result, content: [{ type: "text", text: LEFT_OUT_SOURCE }] };
  }
  return {
    ...result,
    content: result.content.map((part) =>
      part.type === "image" ? { type: "text", text: LEFT_OUT_IMAGE } : part,
    ),
  };
};
