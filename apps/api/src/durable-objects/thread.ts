import {
  EDITOR_MESSAGE_ENTRY,
  isSender,
  threadClientMessageSchema,
  threadSenderSchema,
  type ThreadClientMessage,
  type ThreadServerMessage,
} from "@camox/api-contract/threads";
import { type AgentEventStream, createRegistry, Harness } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { type Connection, type ConnectionContext, Lifecycle } from "agents/lifecycle";
import { type WebSocketMessage, WebSockets } from "agents/websockets";
import { DurableObject } from "cloudflare:workers";

import { threadModel } from "../lib/thread-model";
import type { Bindings } from "../types";

/** The header the API sets on a connection it forwards, naming the signed-in sender. */
export const THREAD_SENDER_HEADER = "x-camox-thread-sender";

/** `WebSocket.OPEN`, which isn't defined on every runtime's global. */
const OPEN = 1;

const PREAMBLE = `You are Camox's agent. Camox is a content management system, and you work with the \
editors of a website in the Camox studio, where they message you in a thread.

Answer in the language the editor writes in. Keep answers short and to the point, formatted in \
Markdown when it helps.

End every turn with a short summary: what you changed, and what's left for the editor to check.`;

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
    harness: ({ storage, context }) => {
      this.#registry.install({
        name: "camox",
        sections: [{ key: "preamble", render: () => PREAMBLE, tag: false }],
        tools: [],
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
    if (!sender.success) {
      connection.close(1008, "Unauthorized");
      return;
    }
    connection.setState(sender.data);
    await this.#watch(connection);
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
