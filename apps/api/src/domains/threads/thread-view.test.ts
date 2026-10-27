import {
  BUILD_STATUS_ENTRY,
  type BuildStatus,
  EDITOR_MESSAGE_ENTRY,
  EMPTY_THREAD_STATE,
  reduceThreadEvents,
  RUN_STOPPED_ENTRY,
  START_DRAFT_TOOL,
  threadViewOf,
} from "@camox/api-contract/threads";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentEvent, EntryRecord } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";

// What the studio shows for transcripts the threads' integration tests can't produce on demand,
// such as an answer racing a stop.

const editor = { id: "user-1", name: "Ada Lovelace", image: null };

/**
 * A snapshot of a thread whose transcript is `entries`, with no run going unless `running`, and
 * the model's `tools` calls of the round.
 */
const snapshot = (
  entries: Omit<EntryRecord, "id" | "conversationId">[],
  {
    running = false,
    tools = [],
  }: { running?: boolean; tools?: { callId: string; status: string }[] } = {},
): AgentEvent =>
  ({
    type: "snapshot",
    ...(running && { run: { taskId: "run", inputs: ["input"] } }),
    entries: entries.map((entry, index) => ({ ...entry, id: index + 1, conversationId: "root" })),
    tools,
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

/** The agent on Live calling `startDraft`, and the call's result, failed or not. */
const handOff = (card: { draftId: string; name: string }, { isError = false } = {}) => [
  {
    kind: "pi.assistant",
    model: [
      fauxAssistantMessage([fauxToolCall(START_DRAFT_TOOL, { name: card.name, brief: "…" })], {
        stopReason: "toolUse",
      }),
    ],
  },
  {
    kind: "pi.tool-result",
    model: [
      {
        role: "toolResult" as const,
        toolCallId: "call-1",
        toolName: START_DRAFT_TOOL,
        content: [{ type: "text" as const, text: isError ? "The draft ended." : "{}" }],
        ...(!isError && { details: card }),
        isError,
        timestamp: 0,
      },
    ],
  },
];

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

  it("says the agent uses its tools from writing a call until the model thinks again", () => {
    const call = fauxToolCall("codemode", { code: "await camox.pages.list()" }, { id: "call-1" });
    const calling = fauxAssistantMessage([call], { stopReason: "toolUse" });
    const thinking = fauxAssistantMessage([]);
    const events: AgentEvent[] = [
      snapshot([editorMessage("Which pages mention pricing?")], { running: true }),
      { type: "message_start", message: thinking },
      {
        type: "message_update",
        usage: thinking.usage,
        changes: [{ type: "text_start", contentIndex: 0, block: fauxText("") }],
      },
      {
        type: "message_update",
        usage: thinking.usage,
        changes: [{ type: "toolcall_start", contentIndex: 1, block: call }],
      },
      {
        type: "message_end",
        entry: {
          id: 2,
          conversationId: "root",
          kind: "pi.assistant",
          model: [calling],
        } as unknown as EntryRecord,
      },
      { type: "tool_execution_start", toolCallId: "call-1", toolName: "codemode", args: {} },
      { type: "tool_execution_end", toolCallId: "call-1", toolName: "codemode" },
      { type: "message_start", message: thinking },
    ];
    const usingTools = (count: number) =>
      threadViewOf(reduceThreadEvents(EMPTY_THREAD_STATE, events.slice(0, count))).usingTools;

    expect(usingTools(3)).toBeUndefined();
    expect(usingTools(4)).toBe(true);
    expect(usingTools(5)).toBe(true);
    expect(usingTools(6)).toBe(true);
    expect(usingTools(7)).toBe(true);
    expect(usingTools(8)).toBeUndefined();
  });

  it("says the agent uses its tools while a call it made runs, not a tool's own calls", () => {
    const running = (tools: { callId: string; status: string }[], after: AgentEvent[] = []) =>
      threadViewOf(
        reduceThreadEvents(EMPTY_THREAD_STATE, [
          snapshot([editorMessage("Translate the home page")], { running: true, tools }),
          ...after,
        ]),
      ).usingTools;

    expect(running([{ callId: "call-1", status: "running" }])).toBe(true);
    expect(running([{ callId: "call-1", status: "done" }])).toBeUndefined();
    expect(
      running(
        [],
        [
          {
            type: "tool_execution_start",
            toolCallId: "call-1/0",
            toolName: "pages_list",
            args: {},
            parentToolCallId: "call-1",
          },
        ],
      ),
    ).toBeUndefined();
    expect(
      running([{ callId: "call-1", status: "running" }], [{ type: "run_end", inputs: [] }]),
    ).toBeUndefined();
  });

  it("ends a Live turn handed off to a draft on the draft's card, as finished", () => {
    const card = { draftId: "draft-1", name: "New prices" };
    const view = threadViewOf(
      reduceThreadEvents(EMPTY_THREAD_STATE, [
        snapshot([editorMessage("Raise the price"), ...handOff(card)]),
      ]),
    );

    expect(view.messages.map(({ from }) => from)).toEqual(["editor", "draft"]);
    expect(view.messages.at(-1)).toMatchObject({ from: "draft", ...card });
  });

  it("shows a startDraft call that failed as a turn Camox couldn't finish, with no card", () => {
    expect(
      shown(
        [
          editorMessage("Raise the price"),
          ...handOff({ draftId: "d", name: "N" }, { isError: true }),
        ],
        false,
      ).said,
    ).toEqual(["editor", "failed"]);
  });

  it("keeps a card a Live turn ended on as the next turn starts", () => {
    expect(
      shown([
        editorMessage("Raise the price"),
        ...handOff({ draftId: "d", name: "N" }),
        editorMessage("And the launch page?"),
        answer("It's in the draft."),
      ]).said,
    ).toEqual(["editor", "draft", "editor", "agent"]);
  });
});
