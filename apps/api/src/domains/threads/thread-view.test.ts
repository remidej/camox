import {
  BUILD_STATUS_ENTRY,
  type BuildStatus,
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

/** A snapshot of a thread whose transcript is `entries`, with no run going unless `running`. */
const snapshot = (
  entries: Omit<EntryRecord, "id" | "conversationId">[],
  { running = false }: { running?: boolean } = {},
): AgentEvent =>
  ({
    type: "snapshot",
    ...(running && { run: { taskId: "run", inputs: ["input"] } }),
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

const buildStatus = (status: BuildStatus) => ({ kind: BUILD_STATUS_ENTRY, data: { status } });

/** The message Pi continues a run with when the end of a turn sends the agent back to work. */
const continuation = (text: string) => ({
  kind: "pi.user",
  model: [{ role: "user" as const, content: text, timestamp: 0 }],
});

/** What a thread shows once Pi's events brought it `entries`: its messages and its status. */
const shown = (entries: Omit<EntryRecord, "id" | "conversationId">[], running = true) => {
  const view = threadViewOf(
    reduceThreadEvents(EMPTY_THREAD_STATE, [snapshot(entries, { running })]),
  );
  return { said: view.messages.map(({ from }) => from), status: view.status };
};

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

  it("hides the answers the end of a turn sent back, and the messages it continued with", () => {
    const view = threadViewOf(
      reduceThreadEvents(EMPTY_THREAD_STATE, [
        snapshot([
          editorMessage("Add a pricing section"),
          buildStatus("building"),
          buildStatus("fixing"),
          answer("I added a pricing section."),
          continuation("Your code changes don't build"),
          buildStatus("building"),
          answer("I added a pricing section, and fixed it."),
        ]),
      ]),
    );

    expect(view.messages).toEqual([
      expect.objectContaining({ from: "editor", text: "Add a pricing section" }),
      expect.objectContaining({ from: "agent", text: "I added a pricing section, and fixed it." }),
    ]);
  });

  it("says the turn's code is building, then that the agent fixes it, until the turn ends", () => {
    const asked = editorMessage("Add a pricing section");
    const building = [asked, buildStatus("building")];
    const fixing = [
      ...building,
      buildStatus("fixing"),
      answer("Done."),
      continuation("Your code changes don't build"),
    ];
    const buildingAgain = [...fixing, buildStatus("building")];
    const ended = [...buildingAgain, answer("Done, and fixed.")];

    expect(shown([asked])).toEqual({ said: ["editor"], status: undefined });
    expect(shown(building)).toEqual({ said: ["editor"], status: "building" });
    expect(shown(fixing)).toEqual({ said: ["editor"], status: "fixing" });
    expect(shown(buildingAgain)).toEqual({ said: ["editor"], status: "building" });
    expect(shown(ended)).toEqual({ said: ["editor", "agent"], status: undefined });
    expect(shown(fixing, false).status).toBeUndefined();
  });

  it("drops the status once the end of a turn gives up fixing, as the agent explains", () => {
    expect(
      shown([
        editorMessage("Add a pricing section"),
        buildStatus("building"),
        answer("Done."),
        continuation("Your code changes still don't build"),
      ]),
    ).toEqual({ said: ["editor"], status: undefined });
  });
});
