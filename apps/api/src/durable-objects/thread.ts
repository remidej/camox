import {
  EDITOR_MESSAGE_ENTRY,
  isSender,
  threadClientMessageSchema,
  threadSenderSchema,
  type ThreadClientMessage,
  type ThreadSender,
  type ThreadServerMessage,
} from "@camox/api-contract/threads";
import { RemoteCodemodeSandbox } from "@earendil-works/pi-codemode/portable";
import {
  type AgentEventStream,
  createRegistry,
  Harness,
  LiveDoc,
} from "@earendil-works/pi-durable";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";
import { PiHarness } from "agents/harness/pi";
import { type Connection, type ConnectionContext, Lifecycle } from "agents/lifecycle";
import { type WebSocketMessage, WebSockets } from "agents/websockets";
import { DurableObject } from "cloudflare:workers";

import {
  studioAgentTools,
  type ThreadActor,
  type ThreadIdentity,
  threadIdentitySchema,
  threadToolDispatch,
  type ToolInvocation,
} from "../domains/threads/tools";
import { threadModel } from "../lib/thread-model";
import type { Bindings } from "../types";

/** The header the API sets on a connection it forwards, naming the signed-in sender. */
export const THREAD_SENDER_HEADER = "x-camox-thread-sender";

/** The header the API sets on a connection it forwards, naming the thread's project and owner. */
export const THREAD_IDENTITY_HEADER = "x-camox-thread-identity";

const IDENTITY_KEY = "camox.identity";

/** `WebSocket.OPEN`, which isn't defined on every runtime's global. */
const OPEN = 1;

const PREAMBLE = `You are Camox's agent. Camox is a content management system, and you work with the \
editors of a website in the Camox studio, where they message you in a thread.

Answer in the language the editor writes in. Keep answers short and to the point, formatted in \
Markdown when it helps.

You read and change the website's content by running scripts with the codemode tool, which call \
the content tools. Read before you answer or change anything: ground your work in the website's \
actual content. Make many changes in one script when you can.

End every turn with a short summary: what you changed, and what's left for the editor to check.`;

/** Where the agent works: the thread's draft, or Live, which is read-only. */
const workplace = (identity: ThreadIdentity | undefined) =>
  identity?.draftId
    ? `You work in a draft: every change you make lands in it, never on Live, and editors see \
it as you make it. You can't publish or discard the draft: an editor reviews it and decides.`
    : `The editor is viewing Live, which is read-only: you can read the website, but not change \
it from here.`;

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

/** Whether a connection the API authorized for `named` reaches the thread `known` describes. */
const belongsTo = (known: ThreadIdentity, named: ThreadIdentity) =>
  known.projectId === named.projectId &&
  (known.draftId !== null ? named.draftId === known.draftId : named.ownerId === known.ownerId);

const send = (socket: WebSocket, message: ThreadServerMessage) => {
  if (socket.readyState !== OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // The socket closed between the check and the send.
  }
};

/**
 * One thread with Camox's agent, addressed by the thread's own id. Pi Durable runs the agent
 * through Cloudflare's `PiHarness`, so a run is saved at every step and carries on with no client
 * connected (ADR 0018).
 *
 * The API authorizes every connection before forwarding it here, naming the sender in
 * `THREAD_SENDER_HEADER`. Each socket gets a snapshot of Pi's agent events, then a batch per
 * commit; it sends editors' messages and can ask to resync.
 */
export class Thread extends DurableObject<Bindings> {
  readonly #model = threadModel(this.env);
  readonly #registry = createRegistry();
  readonly #watches = new Map<WebSocket, AgentEventStream>();

  readonly harness = new PiHarness({
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
        (invocation) => this.#actor(invocation),
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

  /** Gives sockets that outlived the last isolate a new watch and a fresh snapshot. */
  async onStart() {
    for (const socket of this.ctx.getWebSockets()) await this.#watch(socket);
  }

  async #onConnect(connection: Connection, ctx: ConnectionContext) {
    const sender = threadSenderSchema.safeParse(
      parseJson(ctx.request.headers.get(THREAD_SENDER_HEADER)),
    );
    const identity = threadIdentitySchema.safeParse(
      parseJson(ctx.request.headers.get(THREAD_IDENTITY_HEADER)),
    );
    if (!sender.success || !identity.success) {
      connection.close(1008, "Unauthorized");
      return;
    }
    // The first connection records what the thread belongs to. A draft's thread reaches whoever
    // the API let into that draft; a Live thread only ever reaches its owner.
    const known = await this.#knownIdentity();
    if (!known) {
      await this.ctx.storage.put(IDENTITY_KEY, identity.data);
    } else if (!belongsTo(known, identity.data)) {
      console.error("A thread refused a connection naming another project, draft or owner", {
        known,
        named: identity.data,
      });
      connection.close(1008, "Unauthorized");
      return;
    }
    connection.setState(sender.data);
    await this.#watch(connection);
  }

  /** What the thread belongs to, once its first connection recorded it. */
  async #knownIdentity(): Promise<ThreadIdentity | undefined> {
    const known = threadIdentitySchema.safeParse(await this.ctx.storage.get(IDENTITY_KEY));
    return known.success ? known.data : undefined;
  }

  /**
   * Who a tool call acts as, and where: the editor whose message started the run, whoever steers
   * it since, in the thread's draft, or on Live for a Live thread.
   */
  async #actor(invocation: ToolInvocation): Promise<ThreadActor> {
    const identity = await this.#knownIdentity();
    if (!identity) throw new Error("The thread doesn't know what it belongs to yet");
    const starter = await this.#runStarter(invocation);
    return { projectId: identity.projectId, draftId: identity.draftId, userId: starter.id };
  }

  /** The sender of the message that started the run a tool call is part of. */
  async #runStarter({ api, context }: ToolInvocation): Promise<ThreadSender> {
    // The run's first input is the message that started it, and its entry records its sender.
    const live = await api.snapshot(LiveDoc, api.conversationId, context);
    const started = live?.run?.inputs[0];
    const pi = await this.harness.pi();
    const submission = started && (await pi.submission(started, context));
    const entryId = submission ? (await submission.status(context)).entry : undefined;
    const conversation = await pi.conversation(api.conversationId, context);
    const found =
      entryId &&
      (await conversation?.entries(
        { minEntryId: entryId, maxEntryId: entryId },
        1,
        undefined,
        context,
      ));
    const entry = found ? found.items[0] : undefined;
    if (entry?.kind !== EDITOR_MESSAGE_ENTRY || !isSender(entry.data)) {
      throw new Error("The thread's run wasn't started by an editor's message");
    }
    return entry.data;
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

    switch (message.type) {
      case "send": {
        const sender = connection.state;
        if (!isSender(sender)) {
          connection.close(1008, "Unauthorized");
          return;
        }
        try {
          await this.harness.submit(message.text, {
            operationId: message.operationId,
            entry: { kind: EDITOR_MESSAGE_ENTRY, data: sender },
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
      case "resync":
        await this.#watch(connection);
        return;
    }
  }
}
