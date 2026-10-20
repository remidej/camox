import {
  EDITOR_MESSAGE_ENTRY,
  EMPTY_THREAD_STATE,
  reduceThreadEvents,
  RUN_STOPPED_ENTRY,
  threadViewOf,
} from "@camox/api-contract/threads";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import type { AgentEvent, EntryRecord } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";

// What the studio shows for transcripts the threads' integration tests can't produce on demand,
// such as an answer racing a stop.

const editor = { id: "user-1", name: "Ada Lovelace", image: null };

/** A snapshot of a thread whose transcript is `entries`, with no run going. */
const snapshot = (entries: Omit<EntryRecord, "id" | "conversationId">[]): AgentEvent =>
  ({
    type: "snapshot",
    entries: entries.map((entry, index) => ({ ...entry, id: index + 1, conversationId: "root" })),
    tools: [],
    nestedTools: [],
    compactions: [],
    inbox: [],
  }) as unknown as AgentEvent;

const editorMessage = (text: string) => ({
  kind: EDITOR_MESSAGE_ENTRY,
  data: editor,
  model: [{ role: "user" as const, content: text, timestamp: 0 }],
});

const answer = (text: string) => ({
  kind: "pi.assistant",
  model: [fauxAssistantMessage([fauxText(text)])],
});

describe("a thread's view", () => {
  it("leaves out an answer a stopped run wrote after the stop", () => {
    const state = reduceThreadEvents(EMPTY_THREAD_STATE, [
      snapshot([
        editorMessage("Rewrite every page"),
        { kind: RUN_STOPPED_ENTRY, data: editor },
        answer("I rewrote every page."),
      ]),
    ]);

    expect(threadViewOf(state).messages.map(({ from }) => from)).toEqual(["editor", "stopped"]);
  });
});
