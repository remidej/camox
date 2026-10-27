import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { AgentEvent, EntryRecord } from "@earendil-works/pi-durable";
import { z } from "zod";

// A thread with Camox's agent, as the studio shows it. The thread's Durable Object sends Pi's own
// agent events over its socket, and this module is the one place that interprets them: the
// studio and the API's tests fold them with the same code.

/**
 * The kind of the transcript entry recording an editor's message, with its sender and the
 * operation id the studio sent it with as data (`editorMessageDataSchema`).
 */
export const EDITOR_MESSAGE_ENTRY = "camox.editor-message";

/** The kind of the transcript entry recording that an editor stopped a run, with them as data. */
export const RUN_STOPPED_ENTRY = "camox.run-stopped";

/**
 * The kind of the transcript entry recording where the build of the code a turn changed stands,
 * as the turn ends, with a `buildStatusDataSchema` as data: it started, or it failed and the
 * agent is fixing it. The model never sees it.
 */
export const BUILD_STATUS_ENTRY = "camox.build-status";

/**
 * The kind of the transcript entry starting Camox's own turn, which reconciles the draft's code
 * with Live's when merging it clashed, with a `reconcileDataSchema` as data: the short message
 * editors see. The model gets Camox's instructions instead.
 */
export const RECONCILE_ENTRY = "camox.reconcile";

/**
 * The kind of the transcript entry opening a draft's thread a Live thread handed a request off
 * to: the Brief, which the model reads and editors see as from Camox, ahead of the editor's
 * messages.
 */
export const BRIEF_ENTRY = "camox.brief";

export const reconcileDataSchema = z.object({ message: z.string() });

export const buildStatusSchema = z.enum(["building", "fixing"]);
export type BuildStatus = z.infer<typeof buildStatusSchema>;

export const buildStatusDataSchema = z.object({ status: buildStatusSchema });

/** Who sent a message in a thread. */
export const threadSenderSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
});
export type ThreadSender = z.infer<typeof threadSenderSchema>;

/** Whether `data` names a sender. */
export const isSender = (data: unknown): data is ThreadSender =>
  threadSenderSchema.safeParse(data).success;

/** What an editor's message entry records: who sent it, and the operation id it was sent with. */
export const editorMessageDataSchema = threadSenderSchema.extend({
  operationId: z.string().optional(),
});

/**
 * A draft a Live thread started with its first write, becoming its thread, and the operation ids
 * of the messages of the run that made the write: the studio that sent one of them enters the
 * draft with the thread.
 */
export const startedDraftSchema = z.object({
  draftId: z.string(),
  operationIds: z.array(z.string()),
});
export type StartedDraft = z.infer<typeof startedDraftSchema>;

/** How a write touched what it names. */
export const touchKindSchema = z.enum(["created", "edited", "moved", "deleted", "settings"]);
export type TouchKind = z.infer<typeof touchKindSchema>;

/**
 * One thing a script's successful write touched, named so the studio can locate it: a Page (and
 * its Block, if any), a Synced Block's shared content, by its block definition, or a Layout (and
 * its Block, if any). `settings` is a Page's settings only (nickname, path, SEO, layout). `locale`
 * is the Locale the write was in, for a localized tool. Writes to Collection Records, Files and
 * Locales aren't on the Canvas, so they're left out.
 */
const touchBaseSchema = z.object({ kind: touchKindSchema, locale: z.string().optional() });

export const touchSchema = z.discriminatedUnion("entity", [
  touchBaseSchema.extend({
    entity: z.literal("page"),
    pageId: z.string(),
    blockId: z.string().optional(),
  }),
  touchBaseSchema.extend({
    entity: z.literal("synced-block"),
    /** The Synced Block's block definition id. */
    blockType: z.string(),
  }),
  touchBaseSchema.extend({
    entity: z.literal("layout"),
    layoutId: z.string(),
    blockId: z.string().optional(),
  }),
]);
export type Touch = z.infer<typeof touchSchema>;

/**
 * What one code-mode script's successful writes touched, in write order, and the operation ids
 * of the messages of the run it belongs to: only the studio that sent one of them follows it.
 */
export const touchedBatchSchema = z.object({
  operationIds: z.array(z.string()),
  touches: z.array(touchSchema),
});
export type TouchedBatch = z.infer<typeof touchedBatchSchema>;

/** A message the studio shows in a thread. */
export type ThreadMessage =
  | { id: string; from: "editor"; sender: ThreadSender; text: string }
  /** Camox's own message, starting a turn it began itself: why it did. */
  | { id: string; from: "camox"; text: string }
  /** The agent's final message of a turn, in Markdown. */
  | { id: string; from: "agent"; text: string }
  /**
   * In place of the agent's message, for a turn that ended without one: the model failed (after
   * Pi's retries), or its answer was cut short. Sending again retries.
   */
  | { id: string; from: "failed" }
  /** In place of the agent's message, for a turn an editor stopped: `sender` stopped it. */
  | { id: string; from: "stopped"; sender: ThreadSender };

/** Where a Live thread's messages went when it started a draft, beside its transcript. */
type LiveThreadHandoff = {
  /**
   * The draft this Live thread started with its first write, whose thread it became. The studio
   * that sent a message of that run enters the draft with the thread; other tabs on Live move to
   * the editor's fresh Live thread.
   */
  startedDraft?: StartedDraft;
  /** The draft the editor's previous Live thread continued in, for a fresh Live thread. */
  continuedIn?: StartedDraft;
};

/** Everything the studio shows for a thread. */
export type ThreadView = LiveThreadHandoff & {
  messages: readonly ThreadMessage[];
  /** Whether a run is going: the agent is working on a turn, and stopping would end it. */
  running: boolean;
  /**
   * While a run is going, where the build of the code its turn changed stands: the end of the
   * turn is building it, or it failed and the agent is fixing it.
   */
  status?: BuildStatus;
  /**
   * While a run is going, whether the agent is using its tools, code mode included, rather than
   * thinking: from writing a call until the model is called again.
   */
  usingTools?: true;
};

export const EMPTY_THREAD_VIEW: ThreadView = { messages: [], running: false };

/**
 * What a thread's view is folded from: the steps of its transcript that matter to the studio,
 * and whether a run is going. The studio and the tests fold Pi's events into this, and derive
 * the view from it with `threadViewOf`, so a snapshot and the events that led to it show the same.
 */
export type ThreadState = LiveThreadHandoff & {
  steps: readonly ThreadStep[];
  running: boolean;
  /** The model's calls still running, by call id. A tool's own calls aren't the agent's. */
  toolCalls?: readonly string[];
  /** Whether the model's latest message makes tool calls: it writes them, then they run. */
  callingTools?: boolean;
};

export const EMPTY_THREAD_STATE: ThreadState = { steps: [], running: false };

/** One transcript entry, as far as the studio's view is concerned. */
type ThreadStep = { id: string } & (
  | { type: "editor"; sender: ThreadSender; text: string }
  /** Camox starting a turn of its own, saying why. */
  | { type: "camox"; text: string }
  | { type: "answer"; text: string }
  /** A round of tool calls, or their results: the run goes on after it. */
  | { type: "tools" }
  /** A model call that ended without an answer: failed, aborted, or cut short. */
  | { type: "unfinished" }
  | { type: "stopped"; sender: ThreadSender }
  /** Where the build of the turn's code stands, as the turn ends. */
  | { type: "build"; status: BuildStatus }
  /**
   * The end of the turn sent the agent back to work, after its answer: the answer wasn't the
   * turn's last, and what the agent was told is never shown.
   */
  | { type: "continued" }
);

/** Studio → thread. */
export const threadClientMessageSchema = z.discriminatedUnion("type", [
  /**
   * An editor's message. The operation id is generated by the studio and kept across resends, so
   * a message resent after a dropped connection is one submission.
   */
  z.object({ type: z.literal("send"), operationId: z.string().min(1), text: z.string().min(1) }),
  /** Stops the run going, if any. What the agent changed before stays. */
  z.object({ type: z.literal("stop") }),
  /** Asks for a fresh snapshot of the thread. */
  z.object({ type: z.literal("resync") }),
]);
export type ThreadClientMessage = z.infer<typeof threadClientMessageSchema>;

/** Thread → studio. */
export type ThreadServerMessage =
  /**
   * Pi's agent events. The first batch after connecting or resyncing starts with a `snapshot`,
   * which replaces whatever the studio folded before.
   */
  | { type: "events"; events: readonly AgentEvent[] }
  /** The thread recorded the message sent with this operation id (once, however often sent). */
  | { type: "accepted"; operationId: string }
  /** This Live thread started a draft with its first write, and became that draft's thread. */
  | { type: "started-draft"; startedDraft: StartedDraft }
  /**
   * The editor's previous Live thread continued in this draft: this one is fresh. Sent before
   * the snapshot.
   */
  | { type: "continued-in"; continuedIn: StartedDraft }
  /**
   * A code-mode script that wrote something ended, failed or not: what its successful writes
   * touched. Sent once per such script, live only: a snapshot never replays past touches.
   */
  | { type: "touched"; touched: TouchedBatch }
  | { type: "error"; operationId?: string; message: string };

/**
 * The code a thread closes its sockets with once it ended with its draft, and for good: it's
 * deleted, so reconnecting reaches nothing. A development draft, which stays open, gets a new
 * thread the next time the studio connects.
 */
export const THREAD_ENDED_CLOSE_CODE = 4000;

const textOf = (content: Message["content"]) =>
  typeof content === "string"
    ? content
    : content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("")
        .trim();

/** What an assistant message is to the thread: a final answer, a tool round, or neither. */
function assistantStep(id: string, message: AssistantMessage): ThreadStep {
  if (message.content.some((part) => part.type === "toolCall")) return { id, type: "tools" };
  // Thinking is never shown. An answer cut short by the model's length limit isn't one.
  const text = message.stopReason === "stop" ? textOf(message.content) : "";
  return text ? { id, type: "answer", text } : { id, type: "unfinished" };
}

/** The sender an entry's data names, if any, without other fields it may carry. */
function senderOf(data: unknown): ThreadSender | undefined {
  if (!isSender(data)) return undefined;
  const { id, name, image } = data;
  return { id, name, image };
}

/** The step an entry is, if it's one the view depends on. */
function threadStepOf(entry: EntryRecord): ThreadStep | undefined {
  const id = String(entry.id);
  const sender = senderOf(entry.data);
  if (entry.kind === RUN_STOPPED_ENTRY && sender) return { id, type: "stopped", sender };
  if (entry.kind === BUILD_STATUS_ENTRY) {
    const build = buildStatusDataSchema.safeParse(entry.data).data;
    return build && { id, type: "build", status: build.status };
  }
  const message = entry.model?.find((candidate) => candidate.role !== "system");
  if (!message) return undefined;
  if (message.role === "user") {
    if (entry.kind === EDITOR_MESSAGE_ENTRY) {
      return sender && { id, type: "editor", sender, text: textOf(message.content) };
    }
    if (entry.kind === BRIEF_ENTRY) return { id, type: "camox", text: textOf(message.content) };
    if (entry.kind === RECONCILE_ENTRY) {
      const reconcile = reconcileDataSchema.safeParse(entry.data).data;
      return reconcile && { id, type: "camox", text: reconcile.message };
    }
    // Editors' messages have a kind of their own: a user message without it is Pi continuing a
    // run as the end of a turn asked.
    return { id, type: "continued" };
  }
  if (message.role === "assistant") return assistantStep(id, message);
  if (message.role === "toolResult") return { id, type: "tools" };
  return undefined;
}

/**
 * What the studio shows for a thread. A turn starts with an editor's message, or Camox's own
 * when it began the turn itself, and messages sent
 * while it runs join it. It ends with the agent's final message; text written beside tool calls
 * is never shown. A stopped turn shows who stopped it instead, and whatever its run wrote after
 * the stop is left out. A turn that ended without either shows a failed line in its place: its
 * run is over, or a later message started another run after its last model call came back
 * unfinished. While Pi retries a failed call, the run goes on, so the turn shows as working.
 */
export function threadViewOf({
  steps,
  running,
  toolCalls = [],
  callingTools = false,
  ...drafts
}: ThreadState): ThreadView {
  const messages: ThreadMessage[] = [];
  // The latest editor's message of a turn still waiting for the agent's message.
  let waiting: string | undefined;
  let unfinished = false;
  let status: BuildStatus | undefined;
  // The turn the agent's last answer ended, and the status before it: the end of the turn may
  // send the agent back to work after it.
  let answered: { waiting: string | undefined; status: BuildStatus | undefined } | undefined;
  /** Ends the turn waiting for the agent's message, if any. */
  const endTurn = () => {
    waiting = undefined;
    unfinished = false;
    status = undefined;
    answered = undefined;
  };
  /** Ends the turn waiting for the agent's message with a failed line, if any. */
  const fail = () => {
    if (waiting !== undefined) messages.push({ id: `${waiting}:failed`, from: "failed" });
    endTurn();
  };

  for (const step of steps) {
    switch (step.type) {
      case "editor":
        // Pi places a steering message only once a model call is settled: after a round of tool
        // calls, or with the answer ending the run. Never between a failed call and its retry, so
        // an editor's message after an unfinished call means that call's turn is over.
        if (unfinished) fail();
        messages.push({ id: step.id, from: "editor", sender: step.sender, text: step.text });
        waiting = step.id;
        break;
      case "camox":
        if (unfinished) fail();
        messages.push({ id: step.id, from: "camox", text: step.text });
        waiting = step.id;
        break;
      case "stopped":
        if (waiting === undefined) break;
        messages.push({ id: step.id, from: "stopped", sender: step.sender });
        endTurn();
        break;
      case "answer":
        // A stopped turn's run may still answer before it ends.
        if (waiting === undefined && messages.at(-1)?.from === "stopped") break;
        messages.push({ id: step.id, from: "agent", text: step.text });
        {
          const before = { waiting, status };
          endTurn();
          answered = before;
        }
        break;
      case "continued":
        // The answer before wasn't the turn's last. Once the end of the turn gives up fixing,
        // the agent explains without a status.
        if (!answered) break;
        if (messages.at(-1)?.from === "agent") messages.pop();
        waiting = answered.waiting;
        status = answered.status === "fixing" ? "fixing" : undefined;
        answered = undefined;
        break;
      case "build":
        status = step.status;
        break;
      case "tools":
        unfinished = false;
        break;
      case "unfinished":
        unfinished = true;
        break;
    }
  }
  if (!running) fail();
  const usingTools = running && (callingTools || toolCalls.length > 0);
  return {
    ...drafts,
    messages,
    running,
    ...(running && status && { status }),
    ...(usingTools && { usingTools }),
  };
}

const append = (state: ThreadState, entry: EntryRecord | undefined): ThreadState => {
  const step = entry && threadStepOf(entry);
  if (!step || state.steps.some((known) => known.id === step.id)) return state;
  return { ...state, steps: [...state.steps, step] };
};

/** Folds one of Pi's agent events into the thread's state. */
export function reduceThreadState(state: ThreadState, event: AgentEvent): ThreadState {
  switch (event.type) {
    case "snapshot":
      return {
        ...state,
        steps: event.entries.flatMap((entry) => threadStepOf(entry) ?? []),
        running: event.run !== undefined,
        toolCalls: event.tools.flatMap((tool) => (tool.status === "done" ? [] : [tool.callId])),
        callingTools: !!event.generation?.message?.content.some((part) => part.type === "toolCall"),
      };
    case "run_start":
      return { ...state, running: true };
    case "run_end":
      return { ...state, running: false, toolCalls: [], callingTools: false };
    case "message_start":
      // The model is called again: it thinks until it writes a tool call.
      return event.message.role === "assistant" ? { ...state, callingTools: false } : state;
    case "message_update":
      return event.changes.some((change) => change.type === "toolcall_start")
        ? { ...state, callingTools: true }
        : state;
    case "tool_execution_start":
      if (event.parentToolCallId !== undefined) return state;
      return { ...state, toolCalls: [...(state.toolCalls ?? []), event.toolCallId] };
    case "tool_execution_end":
      return append(
        {
          ...state,
          toolCalls: state.toolCalls?.filter((callId) => callId !== event.toolCallId),
        },
        event.entry,
      );
    case "message_end":
    case "entry_appended":
      return append(state, event.entry);
    default:
      return state;
  }
}

/** Folds a batch of Pi's agent events into the thread's state. */
export const reduceThreadEvents = (
  state: ThreadState,
  events: readonly AgentEvent[],
): ThreadState => events.reduce(reduceThreadState, state);

/** Folds what the thread sent over its socket into the thread's state. */
export function reduceThreadFrame(state: ThreadState, frame: ThreadServerMessage): ThreadState {
  switch (frame.type) {
    case "events":
      return reduceThreadEvents(state, frame.events);
    case "started-draft":
      return { ...state, startedDraft: frame.startedDraft };
    case "continued-in":
      return { ...state, continuedIn: frame.continuedIn };
    default:
      return state;
  }
}
