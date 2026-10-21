import { generateUuidv7 } from "@camox/api-contract/ids";
import {
  EDITOR_MESSAGE_ENTRY,
  editorMessageDataSchema,
  isSender,
  RUN_STOPPED_ENTRY,
  type StartedDraft,
  startedDraftSchema,
  THREAD_ENDED_CLOSE_CODE,
  threadClientMessageSchema,
  threadSenderSchema,
  type ThreadClientMessage,
  type ThreadSender,
  type ThreadServerMessage,
  type Touch,
  type TouchedBatch,
  touchedBatchSchema,
} from "@camox/api-contract/threads";
import { RemoteCodemodeSandbox } from "@earendil-works/pi-codemode/portable";
import {
  type AgentEventStream,
  createRegistry,
  type EntryRecord,
  Harness,
  LiveDoc,
  ROOT_CONVERSATION_ID,
  type SnapshotEvent,
  type ToolRegistration,
  wrapTool,
} from "@earendil-works/pi-durable";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";
import { PiHarness, type PiHarnessOptions } from "agents/harness/pi";
import {
  type CapabilityStartContext,
  type Connection,
  type ConnectionContext,
  Lifecycle,
} from "agents/lifecycle";
import { type WebSocketMessage, WebSockets } from "agents/websockets";
import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import { z } from "zod";

import { createDb } from "../db";
import { moveLiveThreadIntoDraft, reservedDraftState } from "../domains/threads/service";
import {
  studioAgentTools,
  type ThreadActor,
  type ThreadIdentity,
  threadIdentitySchema,
  threadToolDispatch,
  type ToolInvocation,
  type ToolKind,
} from "../domains/threads/tools";
import { threadModel } from "../lib/thread-model";
import type { Bindings } from "../types";

/** The header the API sets on a connection it forwards, naming the signed-in sender. */
export const THREAD_SENDER_HEADER = "x-camox-thread-sender";

/** The header the API sets on a connection it forwards, naming the thread's project and owner. */
export const THREAD_IDENTITY_HEADER = "x-camox-thread-identity";

/**
 * The header the API sets on a connection to a fresh Live thread, naming the draft the editor's
 * previous Live thread continued in (a `StartedDraft`).
 */
export const THREAD_CONTINUED_HEADER = "x-camox-thread-continued-in";

const IDENTITY_KEY = "camox.identity";

/**
 * The draft a Live thread's first write starts, set aside before it's created, with the
 * operations of the run whose write created it once one did (a `StartedDraft`).
 */
const DRAFT_TO_START_KEY = "camox.draft-to-start";

/**
 * The prefix of the keys holding what a running script's writes touched, one key per write:
 * followed by the script's call id, then the write's place among the script's calls.
 */
const TOUCHES_PREFIX = "camox.touches:";

/**
 * Touches of the script whose first write started the draft, kept for the editor's studio
 * entering it when it had no socket open as the script ended: see `#reportTouches`.
 */
const HAND_OFF_KEY = "camox.touches-hand-off";

/**
 * How long touches kept for a studio entering the draft wait for it: about as long as entering
 * takes, so a studio coming back later doesn't follow a run long done.
 */
const HAND_OFF_MS = 30_000;

const handOffSchema = z.object({
  draftId: z.string(),
  editorId: z.string(),
  touched: touchedBatchSchema,
  until: z.number(),
});
type HandOff = z.infer<typeof handOffSchema>;

/** The operation ids of the editors' messages among a run's entries. */
const operationIdsOf = (entries: EntryRecord[]) =>
  entries.flatMap((entry) => editorMessageDataSchema.safeParse(entry.data).data?.operationId ?? []);

/** Code mode's tool, which runs the model's scripts: wrapped by its name. */
const CODEMODE_TOOL = { name: "codemode" } as ToolRegistration;

/** The key recording that the thread ended with its draft, all a thread keeps once it did. */
export const ENDED_KEY = "camox.ended";

/** `WebSocket.OPEN`, which isn't defined on every runtime's global. */
const OPEN = 1;

/**
 * What a connection carries: who sent it, what the API authorized it to reach, and for a fresh
 * Live thread, the draft the editor's previous one continued in.
 */
const participantSchema = z.object({
  sender: threadSenderSchema,
  identity: threadIdentitySchema,
  continuedIn: startedDraftSchema.optional(),
});
type Participant = z.infer<typeof participantSchema>;

/** What a thread nobody messaged yet shows: no messages, without opening Pi, which would store. */
const NOT_STARTED: SnapshotEvent = {
  type: "snapshot",
  entries: [],
  tools: [],
  nestedTools: [],
  compactions: [],
  inbox: [],
  agent: {},
  usage: { models: {}, tools: {} },
};

/**
 * A context that's never cancelled, which pi-durable takes on every call: chord's
 * `BACKGROUND_CONTEXT`, which pi-durable doesn't re-export, inlined as `PiHarness` does.
 */
const BACKGROUND: Parameters<Harness["close"]>[0] = Object.freeze({
  abortSignal: undefined,
  value: () => undefined,
  toString: () => "[Context camox thread background]",
});

const PREAMBLE = `You are Camox's agent. Camox is a content management system, and you work with the \
editors of a website in the Camox studio, where they message you in a thread.

Answer in the language the editor writes in. Keep answers short and to the point, formatted in \
Markdown when it helps.

You read and change the website's content by running scripts with the codemode tool, which call \
the content tools. Read before you answer or change anything: ground your work in the website's \
actual content. Make many changes in one script when you can.

End every turn with a short summary: what you changed, and what's left for the editor to check.`;

/** Where the agent works: the thread's draft, or Live, which is read-only until its first change. */
const workplace = (identity: ThreadIdentity | undefined) =>
  identity?.draftId
    ? `You work in a draft: every change you make lands in it, never on Live, and editors see \
it as you make it. You can't publish or discard the draft: an editor reviews it and decides.`
    : `The editor is viewing Live, which is read-only. Your first change starts a draft, where it \
and every later change lands, never on Live; the editor's studio enters it. You can't publish or \
discard the draft: an editor reviews it and decides.`;

const parseJson = (raw: string | null): unknown => {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

/** A studio's frame, or undefined when it isn't one. */
const parseClientMessage = (raw: string): ThreadClientMessage | undefined => {
  const parsed = threadClientMessageSchema.safeParse(parseJson(raw));
  return parsed.success ? parsed.data : undefined;
};

/**
 * Whether a connection the API authorized for `named` reaches the thread `known` describes: a
 * draft's thread reaches whoever the API let into that draft, and a thread started on Live its
 * owner, still on Live, even once it became a draft's.
 */
const belongsTo = (known: ThreadIdentity, named: ThreadIdentity) =>
  known.projectId === named.projectId &&
  ((known.draftId !== null && named.draftId === known.draftId) ||
    (named.draftId === null && known.ownerId !== null && named.ownerId === known.ownerId));

const send = (socket: WebSocket, message: ThreadServerMessage) => {
  if (socket.readyState !== OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // The socket closed between the check and the send.
  }
};

/**
 * Cloudflare's `PiHarness`, leaving Pi closed when the object starts until `started` holds: Pi
 * creates its tables as it opens, and a thread nobody messaged has no run to resume.
 */
class UntilStartedPiHarness extends PiHarness {
  readonly #started: () => Promise<boolean>;

  constructor(started: () => Promise<boolean>, options: PiHarnessOptions) {
    super(options);
    this.#started = started;
  }

  override async onStart(context: CapabilityStartContext) {
    if (await this.#started()) await super.onStart(context);
  }
}

/**
 * One thread with Camox's agent, addressed by the thread's own id. Pi Durable runs the agent
 * through Cloudflare's `PiHarness`, so a run is saved at every step and carries on with no client
 * connected (ADR 0018).
 *
 * The API authorizes every connection before forwarding it here, naming the sender in
 * `THREAD_SENDER_HEADER`. Each socket gets a snapshot of Pi's agent events, then a batch per
 * commit; it sends editors' messages and can ask to resync.
 *
 * The thread starts with its first message: until then, connecting stores nothing, so opening a
 * draft leaves no thread behind.
 */
export class Thread extends DurableObject<Bindings> {
  readonly #model = threadModel(this.env);
  readonly #registry = createRegistry();
  readonly #watches = new Map<WebSocket, AgentEventStream>();
  /** Settling where the thread stands, which every later settling waits for. */
  #settling: Promise<unknown> = Promise.resolve();
  /** Setting aside the draft this Live thread's first write starts, shared by concurrent writes. */
  #reserving: Promise<string> | undefined;

  readonly harness = new UntilStartedPiHarness(async () => !!(await this.#knownIdentity()), {
    harness: async ({ storage, context }) => {
      // PiHarness opens Pi again after a failed open or `dispose()`. Installing an extension
      // replaces the one of the same name, so a second run leaves the registry as the first did.
      //
      // The model is only offered code mode: content tools are for its scripts, which run in
      // the sandbox Worker's object for this thread and can't call a model (ADR 0018).
      this.#registry.install(
        createCodemodeExtension({
          sandbox: new RemoteCodemodeSandbox({
            remote: () => this.env.CODEMODE_SANDBOX.getByName(this.ctx.id.toString()),
          }),
          models: false,
        }),
      );
      const dispatch = threadToolDispatch(
        this.env,
        (promise) => this.ctx.waitUntil(promise),
        (invocation, kind) => this.#actor(invocation, kind),
        (invocation) => this.#wrote(invocation),
        (invocation, touches) => this.#touched(invocation, touches),
      );
      this.#registry.install({
        name: "camox",
        sections: [
          { key: "preamble", render: () => PREAMBLE, tag: false },
          {
            key: "workplace",
            render: async () => workplace(await this.#knownIdentity()),
            tag: false,
          },
        ],
        tools: await studioAgentTools(dispatch),
        // Once a script ends, failed or not, the studios hear what its writes touched.
        wraps: [
          wrapTool(CODEMODE_TOOL, (tool) => ({
            ...tool,
            execute: async (args, api, context) => {
              try {
                return await tool.execute(args, api, context);
              } finally {
                await this.#reportTouches({ api, context }).catch((error: unknown) =>
                  console.error("A thread couldn't report what a script touched", error),
                );
              }
            },
          })),
        ],
      });
      return Harness.open(
        storage,
        {
          models: this.#model.models,
          registry: this.#registry,
          settings: {
            retry: { enabled: true },
            // Pi keeps idle caches behind timers, which would keep the object from hibernating.
            contextRetentionMs: 0,
            documentRetentionMs: 0,
          },
          onReport: (report) => console.warn("Pi reported a fault in a thread", report),
        },
        context,
      );
    },
    defaults: { model: this.#model.model, thinkingLevel: this.#model.thinkingLevel },
  });

  readonly webSockets = new WebSockets({
    handlers: {
      onConnect: (connection, ctx) => this.#onConnect(connection, ctx),
      onMessage: (connection, message) => this.#onMessage(connection, message),
      onClose: (connection) => this.#unwatch(connection),
      onError: (connection) => this.#unwatch(connection),
    },
  });

  readonly lifecycle = Lifecycle.install(this).use(this.webSockets).use(this.harness);

  /** Whether the thread ended with its draft, known as soon as it starts ending: see `end()`. */
  #ended = false;

  /**
   * Whether the thread ended with its draft: in memory from the moment it starts ending, and in
   * its storage once wiped, for whatever reaches it after.
   */
  async #hasEnded() {
    this.#ended ||= (await this.ctx.storage.get(ENDED_KEY)) === true;
    return this.#ended;
  }

  /**
   * Lifecycle's alarm, which wakes Pi's runs, unless the thread ended: an alarm already on its
   * way when it did would look for the jobs its storage no longer has.
   */
  async alarm() {
    if (await this.#hasEnded()) return;
    await this.lifecycle.alarm();
  }

  /**
   * Gives sockets that outlived the last isolate a new watch and a fresh snapshot, once a move
   * into a draft an eviction cut short is finished.
   */
  async onStart() {
    if ((await this.#hasEnded()) || !(await this.#knownIdentity())) return;
    await this.#settle().catch((error: unknown) =>
      console.error("A thread couldn't move into the draft its write started", error),
    );
    for (const socket of this.ctx.getWebSockets()) await this.#watch(socket);
  }

  async #onConnect(connection: Connection, ctx: ConnectionContext) {
    if (await this.#hasEnded()) {
      this.#turnAway(connection);
      return;
    }
    const participant = participantSchema.safeParse({
      sender: parseJson(ctx.request.headers.get(THREAD_SENDER_HEADER)),
      identity: parseJson(ctx.request.headers.get(THREAD_IDENTITY_HEADER)),
      continuedIn: parseJson(ctx.request.headers.get(THREAD_CONTINUED_HEADER)),
    });
    if (!participant.success) {
      connection.close(1008, "Unauthorized");
      return;
    }
    // A thread whose write started a draft may not have moved into it yet: a teammate opening
    // the draft, or the editor coming back to Live, finishes the move first.
    const known = await this.#settle();
    if (known && !this.#admits(known, participant.data)) {
      connection.close(1008, "Unauthorized");
      return;
    }
    connection.setState(participant.data);
    await this.#show(connection, known);
  }

  /**
   * Whether a started thread reaches a participant: a draft's thread reaches whoever the API let
   * into that draft; a Live thread only ever reaches its owner.
   */
  #admits(known: ThreadIdentity, { identity }: Participant) {
    if (belongsTo(known, identity)) return true;
    console.error("A thread refused a connection naming another project, draft or owner", {
      known,
      named: identity,
    });
    return false;
  }

  /** What the thread belongs to, once its first message started it. */
  async #knownIdentity(): Promise<ThreadIdentity | undefined> {
    const known = threadIdentitySchema.safeParse(await this.ctx.storage.get(IDENTITY_KEY));
    return known.success ? known.data : undefined;
  }

  /** The thread's own id: threads are addressed by it (`getByName`), which names the object. */
  #threadId(): string {
    const threadId = this.ctx.id.name;
    if (!threadId) throw new Error("The thread doesn't know its own id");
    return threadId;
  }

  /**
   * Who a tool call acts as, and where: the editor whose message started the run, in the thread's
   * draft, or on Live for a Live thread, whose first write starts the draft set aside for it.
   */
  async #actor(invocation: ToolInvocation, kind: ToolKind): Promise<ThreadActor> {
    const identity = await this.#settle();
    if (!identity) throw new Error("The thread doesn't know what it belongs to yet");
    const [entry] = await this.#entriesOfRun(invocation, 1);
    if (entry?.kind !== EDITOR_MESSAGE_ENTRY || !isSender(entry.data)) {
      throw new Error("The thread's run wasn't started by an editor's message");
    }
    const actor = {
      projectId: identity.projectId,
      draftId: identity.draftId,
      userId: entry.data.id,
    };
    if (identity.draftId || kind !== "write") return actor;
    return {
      ...actor,
      draftToStart: { id: await this.#draftToStart(), threadId: this.#threadId() },
    };
  }

  /** The draft set aside for this Live thread's first write, if any. */
  async #reservedDraft(): Promise<StartedDraft | undefined> {
    return startedDraftSchema.safeParse(await this.ctx.storage.get(DRAFT_TO_START_KEY)).data;
  }

  /**
   * The draft this Live thread's first write starts, the same for every write until one goes
   * through: concurrent writes share one, so they land in one draft.
   */
  #draftToStart(): Promise<string> {
    this.#reserving ??= (async () => {
      const reserved = await this.#reservedDraft();
      if (reserved) return reserved.draftId;
      const draftId = generateUuidv7();
      await this.ctx.storage.put(DRAFT_TO_START_KEY, { draftId, operationIds: [] });
      return draftId;
    })().catch((error: unknown) => {
      this.#reserving = undefined;
      throw error;
    });
    return this.#reserving;
  }

  /**
   * After a write on Live went through, creating the draft set aside: records the operations of
   * its run, whose studios enter the draft, and moves into the draft.
   */
  async #wrote(invocation: ToolInvocation) {
    const reserved = await this.#reservedDraft();
    if (reserved && reserved.operationIds.length === 0) {
      const operationIds = operationIdsOf(await this.#entriesOfRun(invocation));
      await this.ctx.storage.put(DRAFT_TO_START_KEY, { ...reserved, operationIds });
    }
    await this.#settle();
  }

  /**
   * Records what a script's write touched, until the script ends: Pi names a nested call
   * `<script's call id>/c<place among its calls>`. Kept in storage, so a script an eviction
   * replays still reports the writes it won't run again.
   */
  async #touched({ api }: ToolInvocation, touches: Touch[]) {
    const nested = /^(.+)\/c(\d+)$/.exec(api.callId);
    if (!nested) return;
    const [, script, place] = nested;
    await this.ctx.storage.put(`${TOUCHES_PREFIX}${script}:${place!.padStart(10, "0")}`, touches);
  }

  /**
   * Sends every socket what the script ending touched, with the operations of its run, the way
   * `started-draft` names them: only the studio that sent one of them follows it. Nothing for a
   * script with no successful write. Live only: no snapshot replays it.
   *
   * One exception: a script whose first write on Live started the draft may end while the
   * editor's studio, having left Live for the draft, has no socket open. Its touches then wait for
   * that studio's socket in the draft, for `HAND_OFF_MS`, and reach it once.
   */
  async #reportTouches(invocation: ToolInvocation) {
    const recorded = await this.ctx.storage.list<Touch[]>({
      prefix: `${TOUCHES_PREFIX}${invocation.api.callId}:`,
    });
    if (recorded.size === 0) return;
    const entries = await this.#entriesOfRun(invocation);
    const touched: TouchedBatch = {
      operationIds: operationIdsOf(entries),
      touches: [...recorded.values()].flat(),
    };
    const editorId = threadSenderSchema.safeParse(entries[0]?.data).data?.id;
    let reached = false;
    for (const connection of this.webSockets.getConnections()) {
      send(connection, { type: "touched", touched });
      const participant = participantSchema.safeParse(connection.state).data;
      if (connection.readyState === OPEN && participant?.sender.id === editorId) reached = true;
    }
    if (!reached && editorId) await this.#holdForHandOff(editorId, touched);
    await this.ctx.storage.delete([...recorded.keys()]);
  }

  /** Keeps touches for the editor whose run started the draft, as `#reportTouches` says. */
  async #holdForHandOff(editorId: string, touched: TouchedBatch) {
    const known = await this.#knownIdentity();
    const started = await this.#reservedDraft();
    if (!known?.draftId || started?.draftId !== known.draftId) return;
    if (!touched.operationIds.some((id) => started.operationIds.includes(id))) return;
    const handOff: HandOff = {
      draftId: known.draftId,
      editorId,
      touched,
      until: Date.now() + HAND_OFF_MS,
    };
    await this.ctx.storage.put(HAND_OFF_KEY, handOff);
  }

  /** Hands a socket the touches kept for its studio, if any, once. */
  async #handOver(connection: Connection, participant: Participant | undefined) {
    const handOff = handOffSchema.safeParse(await this.ctx.storage.get(HAND_OFF_KEY)).data;
    if (!handOff) return;
    if (Date.now() > handOff.until) {
      await this.ctx.storage.delete(HAND_OFF_KEY);
      return;
    }
    if (
      participant?.identity.draftId !== handOff.draftId ||
      participant.sender.id !== handOff.editorId
    ) {
      return;
    }
    await this.ctx.storage.delete(HAND_OFF_KEY);
    send(connection, { type: "touched", touched: handOff.touched });
  }

  /**
   * Settles where the thread stands, one settling at a time, returning what it belongs to: a
   * Live thread whose write started a draft moves into it, finishing a move a failure or an
   * eviction cut short. Repeating it changes nothing.
   */
  #settle(): Promise<ThreadIdentity | undefined> {
    const settled = this.#settling.then(() => this.#settleNow());
    this.#settling = settled.catch(() => undefined);
    return settled;
  }

  /**
   * Makes this Live thread the thread of the draft its first write started, which recorded the
   * thread as it was created: the thread acts in the draft from then on, and the editor's next
   * Live thread starts fresh, linking to it. Its sockets hear of it: the studio that sent a
   * message of the run enters the draft, and other tabs on Live move on. When the draft ended
   * before that, the thread stays on Live and sets another aside for its next write.
   */
  async #settleNow(): Promise<ThreadIdentity | undefined> {
    const known = await this.#knownIdentity();
    if (!known || known.draftId !== null) return known;
    const reserved = await this.#reservedDraft();
    if (!reserved) return known;
    const db = createDb(this.env.DB);
    const threadId = this.#threadId();
    const state = await Effect.runPromise(
      reservedDraftState(db, { projectId: known.projectId, draftId: reserved.draftId, threadId }),
    );
    if (state === "unstarted") return known;
    if (state === "ended") {
      await this.ctx.storage.delete(DRAFT_TO_START_KEY);
      this.#reserving = undefined;
      return known;
    }
    await Effect.runPromise(moveLiveThreadIntoDraft(db, { threadId, startedDraft: reserved }));
    const moved: ThreadIdentity = { ...known, draftId: reserved.draftId };
    await this.ctx.storage.put(IDENTITY_KEY, moved);
    for (const socket of this.ctx.getWebSockets()) {
      send(socket, { type: "started-draft", startedDraft: reserved });
    }
    return moved;
  }

  /**
   * The entries Pi recorded for the inputs of the run a tool call is part of, up to `limit`: the
   * message that started the run first, then those that steered it.
   */
  async #entriesOfRun(
    { api, context }: ToolInvocation,
    limit = Number.POSITIVE_INFINITY,
  ): Promise<EntryRecord[]> {
    const live = await api.snapshot(LiveDoc, api.conversationId, context);
    const inputs = live?.run?.inputs.slice(0, limit) ?? [];
    if (inputs.length === 0) return [];
    const pi = await this.harness.pi();
    const conversation = await pi.conversation(api.conversationId, context);
    const entries: EntryRecord[] = [];
    for (const input of inputs) {
      const submission = await pi.submission(input, context);
      const entryId = submission && (await submission.status(context)).entry;
      if (!entryId) continue;
      const found = await conversation?.entries(
        { minEntryId: entryId, maxEntryId: entryId },
        1,
        undefined,
        context,
      );
      if (found?.items[0]) entries.push(found.items[0]);
    }
    return entries;
  }

  /**
   * Shows the thread on a socket: Pi's events once the thread started, or an empty thread before,
   * without opening Pi, which would store.
   */
  async #show(connection: Connection, known: ThreadIdentity | undefined) {
    const participant = participantSchema.safeParse(connection.state).data;
    // Before the snapshot, which the studio waits for to show the thread.
    const continuedIn = participant?.continuedIn;
    if (continuedIn) send(connection, { type: "continued-in", continuedIn });
    // The editor on Live reaching a thread that moved into a draft hears where it went.
    if (known?.draftId && participant?.identity.draftId === null) {
      const startedDraft = await this.#reservedDraft();
      if (startedDraft?.draftId === known.draftId) {
        send(connection, { type: "started-draft", startedDraft });
      }
    }
    if (known) {
      await this.#watch(connection);
      await this.#handOver(connection, participant);
    } else send(connection, { type: "events", events: [NOT_STARTED] });
  }

  /**
   * Starts the thread with a participant's first message, unless it started: records what it
   * belongs to, and shows Pi's events on every socket. False when it belongs to another project, draft or owner.
   */
  async #start(participant: Participant): Promise<boolean> {
    const known = await this.#knownIdentity();
    if (known) return this.#admits(known, participant);
    await this.ctx.storage.put(IDENTITY_KEY, participant.identity);
    for (const socket of this.ctx.getWebSockets()) await this.#watch(socket);
    return true;
  }

  async #watch(socket: WebSocket) {
    await this.#unwatch(socket);
    const stream = await this.harness.session().events();
    this.#watches.set(socket, stream);
    send(socket, { type: "events", events: [stream.snapshot] });
    stream.start(async (events) => {
      if (socket.readyState !== OPEN) {
        void this.#unwatch(socket);
        return;
      }
      send(socket, { type: "events", events });
    });
  }

  async #unwatch(socket: WebSocket) {
    const watch = this.#watches.get(socket);
    if (!watch) return;
    this.#watches.delete(socket);
    await watch.stop();
  }

  async #onMessage(connection: Connection, raw: WebSocketMessage) {
    const message = typeof raw === "string" ? parseClientMessage(raw) : undefined;
    if (!message) {
      send(connection, { type: "error", message: "Malformed message" });
      return;
    }
    // A socket the API forwarded just before the thread ended may reach it after.
    if (await this.#hasEnded()) {
      this.#turnAway(connection);
      return;
    }

    if (message.type === "resync") {
      await this.#show(connection, await this.#knownIdentity());
      return;
    }
    const participant = participantSchema.safeParse(connection.state);
    if (!participant.success) {
      connection.close(1008, "Unauthorized");
      return;
    }
    switch (message.type) {
      case "send": {
        if (!(await this.#start(participant.data))) {
          connection.close(1008, "Unauthorized");
          return;
        }
        try {
          // A message sent while the agent works joins its run after the current round of tool
          // calls, instead of waiting for a run of its own.
          await this.harness.submit(message.text, {
            whenBusy: "steer",
            operationId: message.operationId,
            entry: {
              kind: EDITOR_MESSAGE_ENTRY,
              data: { ...participant.data.sender, operationId: message.operationId },
            },
          });
          send(connection, { type: "accepted", operationId: message.operationId });
        } catch (error) {
          console.error("A thread couldn't take a message", error);
          send(connection, {
            type: "error",
            operationId: message.operationId,
            message: "The message couldn't be sent",
          });
        }
        return;
      }
      case "stop":
        // A thread nobody messaged has no run to stop, and opening Pi to check would store.
        if (!(await this.#knownIdentity())) return;
        await this.#stop(participant.data.sender);
        return;
    }
  }

  /**
   * Ends the thread with its draft, wiping everything it stored, since Pi can't delete a
   * conversation yet: the run going stops, and studios still open on it see an empty thread
   * before their sockets close. The sandbox's object for the thread stores nothing.
   *
   * Its draft no longer names it, and a development draft, which stays open, gets a new thread,
   * but a socket the API forwarded just before may still reach it. So the thread keeps the
   * record that it ended, and turns away every socket and message after, as its alarm does
   * nothing: nothing opens Pi again. The object isn't reset, which would fail whatever reached
   * it next.
   */
  async end() {
    this.#ended = true;
    if (await this.#knownIdentity()) {
      try {
        await this.harness.session().abort();
      } catch (error) {
        console.warn("A thread couldn't stop its run as it ended", error);
      }
    }
    for (const socket of this.ctx.getWebSockets()) {
      await this.#unwatch(socket);
      this.#turnAway(socket);
    }
    await this.lifecycle.disableAlarms();
    await this.lifecycle.dispose();
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put(ENDED_KEY, true);
  }

  /**
   * Shows a socket an empty thread and closes it for good, the thread having ended: the studio
   * doesn't reconnect to it, but to a development draft's new thread.
   */
  #turnAway(socket: WebSocket) {
    send(socket, { type: "events", events: [NOT_STARTED] });
    socket.close(THREAD_ENDED_CLOSE_CODE, "The thread ended");
  }

  /**
   * Stops the run going, if any, recording who stopped it. The record goes first, so the studio
   * never sees the run end without it. What the run changed before the stop stays.
   */
  async #stop(sender: ThreadSender) {
    const piSession = this.harness.session();
    if (!(await piSession.busy())) return;
    // The thread's transcript: Pi's root conversation.
    const root = await (await this.harness.pi()).conversation(ROOT_CONVERSATION_ID, BACKGROUND);
    // An entry of only a kind and data is appended at once, even mid-run, and the model never
    // sees it.
    await root?.submit(
      { type: "write", entry: { kind: RUN_STOPPED_ENTRY, data: sender } },
      BACKGROUND,
    );
    await piSession.abort();
  }
}
