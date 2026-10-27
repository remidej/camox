import {
  BUILD_STATUS_ENTRY,
  type BuildStatus,
  DRAFT_ENDED_ENTRY,
  EDITOR_MESSAGE_ENTRY,
  EMPTY_THREAD_STATE,
  reduceThreadEvents,
  reduceThreadFrame,
  RUN_STOPPED_ENTRY,
  START_DRAFT_TOOL,
  type ThreadServerMessage,
  type ThreadState,
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

/** Camox's note to the agent on Live that a draft it started ended, which the model alone reads. */
const draftEnded = (text: string) => ({
  kind: DRAFT_ENDED_ENTRY,
  data: { draftId: "d" },
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

  it("shows a message handed off with the request in the turn ending on its card, as finished", () => {
    const card = { draftId: "draft-1", name: "New prices" };
    const view = threadViewOf(
      reduceThreadEvents(EMPTY_THREAD_STATE, [
        snapshot([
          editorMessage("Raise the price"),
          ...handOff(card),
          // Sent as the agent handed the request off, which took it to the draft too.
          { ...editorMessage("And the annual plan"), data: { ...editor, handedOffTo: "draft-1" } },
          editorMessage("Thanks"),
          answer("You're welcome."),
        ]),
      ]),
    );

    expect(
      view.messages.map((message) => ("text" in message ? message.text : message.from)),
    ).toEqual(["Raise the price", "And the annual plan", "draft", "Thanks", "You're welcome."]);
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

  it("shows a card's draft as the thread last looked it up, across snapshots", () => {
    const entries = [
      editorMessage("Raise the price"),
      ...handOff({ draftId: "draft-1", name: "New prices" }),
      editorMessage("Add a launch page"),
      ...handOff({ draftId: "draft-2", name: "Launch page" }),
    ];
    const cards = (state: ThreadState) =>
      threadViewOf(state).messages.filter((message) => message.from === "draft");
    const renamed = [
      { type: "events", events: [snapshot(entries)] },
      { type: "drafts", drafts: { "draft-1": { name: "Prices for 2027" } } },
    ] satisfies ThreadServerMessage[];
    const state = renamed.reduce(reduceThreadFrame, EMPTY_THREAD_STATE);

    expect(cards(state)).toEqual([
      { id: expect.any(String), from: "draft", draftId: "draft-1", name: "Prices for 2027" },
      { id: expect.any(String), from: "draft", draftId: "draft-2", name: "Launch page" },
    ]);

    const ended = [
      { type: "drafts", drafts: { "draft-1": { name: "Prices for 2027", ended: "published" } } },
      // A resync's snapshot comes before the thread looks the drafts up again.
      { type: "events", events: [snapshot(entries)] },
    ] satisfies ThreadServerMessage[];
    const after = ended.reduce(reduceThreadFrame, state);

    expect(cards(after)).toEqual([
      {
        id: expect.any(String),
        from: "draft",
        draftId: "draft-1",
        name: "Prices for 2027",
        ended: "published",
      },
      { id: expect.any(String), from: "draft", draftId: "draft-2", name: "Launch page" },
    ]);
  });

  it("keeps the agent's name for a card whose draft's name was cleared", () => {
    const state = [
      {
        type: "events",
        events: [
          snapshot([editorMessage("Raise the price"), ...handOff({ draftId: "d", name: "N" })]),
        ],
      },
      { type: "drafts", drafts: { d: { name: null } } },
    ] satisfies ThreadServerMessage[];

    expect(
      threadViewOf(state.reduce(reduceThreadFrame, EMPTY_THREAD_STATE)).messages.at(-1),
    ).toEqual({
      id: expect.any(String),
      from: "draft",
      draftId: "d",
      name: "N",
    });
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

  it("never shows the note that a draft ended, nor hides the answer before it", () => {
    const ended = draftEnded("The draft New prices was published by Ada Lovelace.");
    const turns = [
      editorMessage("Raise the price"),
      ...handOff({ draftId: "d", name: "N" }),
      editorMessage("Is it live yet?"),
      answer("Not yet."),
    ];

    expect(shown([...turns, ended], false).said).toEqual(["editor", "draft", "editor", "agent"]);
    expect(shown([...turns, ended, editorMessage("And now?"), answer("Yes.")]).said).toEqual([
      "editor",
      "draft",
      "editor",
      "agent",
      "editor",
      "agent",
    ]);
  });
});
