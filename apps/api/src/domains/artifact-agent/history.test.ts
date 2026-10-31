import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type Message,
  type ToolResultMessage,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vite-plus/test";

import { ARTIFACT_PATH } from "./env";
import { artifactHistory, LEFT_OUT_IMAGE, LEFT_OUT_SOURCE, PROMPT_CACHE_TTL_MS } from "./history";

const ORBIT = "<!doctype html><title>Orbit</title><script>const speed = 1;</script>";
const SCREENSHOT = { type: "image" as const, data: "iVBORw0KGgo=", mimeType: "image/png" };

const request = (text: string, timestamp: number): Message => ({
  role: "user",
  content: text,
  timestamp,
});

const calling = (timestamp: number, ...calls: [string, Record<string, unknown>, string][]) =>
  fauxAssistantMessage(
    calls.map(([name, args, id]) => fauxToolCall(name, args as never, { id })),
    { stopReason: "toolUse", timestamp },
  );

const answer = (text: string, timestamp: number) =>
  fauxAssistantMessage(fauxText(text), { timestamp });

const result = (
  id: string,
  toolName: string,
  content: ToolResultMessage["content"],
  timestamp: number,
): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: id,
  toolName,
  content,
  isError: false,
  timestamp,
});

/**
 * An Artifact Agent's first turn, at 0: it reads the website's stylesheet, writes the artifact's
 * first version, looks at it and answers.
 */
const firstTurn: Message[] = [
  request("Draw an orbit", 0),
  calling(1, ["read", { path: "src/styles.css" }, "styles"]),
  result("styles", "read", [{ type: "text", text: ":root { --brand: red; }" }], 2),
  calling(3, ["write", { path: ARTIFACT_PATH, content: ORBIT }, "first"]),
  result("first", "write", [{ type: "text", text: `Successfully wrote to ${ARTIFACT_PATH}` }], 4),
  calling(5, ["look", { target: "/visual" }, "look"]),
  result("look", "look", [{ type: "text", text: "desktop" }, SCREENSHOT], 6),
  answer("The orbit turns once a second.", 7),
];

/** The source written whole, and read back, in `messages`. */
const sourceCopies = (messages: readonly Message[]) =>
  messages.flatMap((message) => {
    if (message.role === "assistant") {
      return message.content.flatMap((part) =>
        part.type === "toolCall" && part.name === "write" ? [part.arguments.content] : [],
      );
    }
    if (message.role === "toolResult" && message.toolName === "read") {
      return message.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
    }
    return [];
  });

const images = (messages: readonly Message[]) =>
  messages.flatMap((message) =>
    message.role === "toolResult" ? message.content.filter((part) => part.type === "image") : [],
  );

describe("artifactHistory", () => {
  it("sends a request made while the prompt is cached as it is", () => {
    const later = 7 + PROMPT_CACHE_TTL_MS - 1;
    const messages = [...firstTurn, request("Make it slower", later)];

    const history = artifactHistory(messages, { prunedBefore: undefined, now: later });

    expect(history.messages).toEqual(messages);
    expect(history.prunedBefore).toBeUndefined();
  });

  it("leaves out earlier sources and screenshots from a turn started once the prompt expired", () => {
    const later = 7 + PROMPT_CACHE_TTL_MS + 1;
    const messages = [...firstTurn, request("Make it slower", later)];

    const history = artifactHistory(messages, { prunedBefore: undefined, now: later });

    // The source written whole is left out; the stylesheet, another file, is kept.
    expect(sourceCopies(history.messages)).toEqual([":root { --brand: red; }", LEFT_OUT_SOURCE]);
    expect(images(history.messages)).toEqual([]);
    const look = history.messages[6] as ToolResultMessage;
    expect(look.content).toEqual([
      { type: "text", text: "desktop" },
      { type: "text", text: LEFT_OUT_IMAGE },
    ]);
    // Requests and answers stay, and so does every message, each tool call with its result.
    expect(history.messages).toHaveLength(messages.length);
    expect(history.messages[0]).toEqual(messages[0]);
    expect(history.messages.at(-2)).toEqual(messages.at(-2));
    expect(history.messages.at(-1)).toEqual(messages.at(-1));
  });

  it("leaves out a source read back, under any path naming it", () => {
    const later = 7 + PROMPT_CACHE_TTL_MS + 1;
    const messages = [
      ...firstTurn.slice(0, -1),
      calling(7, ["read", { path: ARTIFACT_PATH.slice(1) }, "check"]),
      result("check", "read", [{ type: "text", text: ORBIT }], 8),
      answer("The orbit turns once a second.", 9),
      request("Make it slower", later + 2),
    ];

    const history = artifactHistory(messages, { prunedBefore: undefined, now: later + 2 });

    expect(sourceCopies(history.messages)).not.toContain(ORBIT);
  });

  it("keeps the turn under way whole, and the history's start the same for each of its requests", () => {
    const later = 7 + PROMPT_CACHE_TTL_MS + 1;
    const opening = [...firstTurn, request("Make it slower", later)];
    const cold = artifactHistory(opening, { prunedBefore: undefined, now: later });

    const slower = ORBIT.replace("speed = 1", "speed = 0.5");
    const going = [
      ...opening,
      calling(later + 10, ["write", { path: ARTIFACT_PATH, content: slower }, "second"]),
      result("second", "write", [{ type: "text", text: "Successfully wrote" }], later + 11),
      calling(later + 12, ["look", { target: "/visual" }, "look2"]),
      result("look2", "look", [SCREENSHOT], later + 13),
    ];
    const next = artifactHistory(going, { prunedBefore: cold.prunedBefore, now: later + 14 });

    expect(next.prunedBefore).toBe(cold.prunedBefore);
    expect(next.messages.slice(0, opening.length)).toEqual(cold.messages);
    expect(next.messages.slice(opening.length)).toEqual(going.slice(opening.length));
  });

  it("keeps where it left out from when a later turn starts while the prompt is cached", () => {
    const later = 7 + PROMPT_CACHE_TTL_MS + 1;
    const opening = [...firstTurn, request("Make it slower", later)];
    const cold = artifactHistory(opening, { prunedBefore: undefined, now: later });
    const warm = [
      ...opening,
      answer("It turns once every two seconds.", later + 10),
      request("Now make it blue", later + 60_000),
    ];

    const history = artifactHistory(warm, {
      prunedBefore: cold.prunedBefore,
      now: later + 60_000,
    });

    expect(history.prunedBefore).toBe(cold.prunedBefore);
    expect(history.messages.slice(0, opening.length)).toEqual(cold.messages);
  });

  it("leaves nothing out of the agent's first request", () => {
    const messages = [request("Draw an orbit", 0)];

    const history = artifactHistory(messages, {
      prunedBefore: undefined,
      now: 10 * PROMPT_CACHE_TTL_MS,
    });

    expect(history).toEqual({ messages, prunedBefore: undefined });
  });
});
