import {
  type AgentActivity,
  EMPTY_THREAD_STATE,
  reduceThreadEvents,
  textOf,
  threadViewOf,
} from "@camox/api-contract/threads";
import {
  type ConversationId,
  type Extension,
  type Harness,
  type InputEntry,
  watchEvents,
} from "@earendil-works/pi-durable";

import { serialQueue } from "../../lib/serial-queue";
import type { AgentModel } from "../../lib/thread-model";
import type { ToolInvocation } from "./tools";

/**
 * A context that's never cancelled, which pi-durable takes on every call: chord's
 * `BACKGROUND_CONTEXT`, which pi-durable doesn't re-export, inlined as `PiHarness` does.
 */
export const BACKGROUND: Parameters<Harness["close"]>[0] = Object.freeze({
  abortSignal: undefined,
  value: () => undefined,
  toString: () => "[Context camox thread background]",
});

type Context = ToolInvocation["context"];

/** How a kind of agent conversation is set up. */
type AgentConversationsOptions = {
  storage: DurableObjectStorage;
  pi: () => Promise<Harness>;
  model: () => AgentModel;
  prefix: string;
  unavailable: string;
  names: AgentNames;
};

/** A request a tool call sends an agent conversation: Pi's request id, its text, and its entry. */
export type AgentRequest = { requestId: string; text: string; entry: InputEntry };

/** How an agent conversation's request ended. */
export type AgentAnswer =
  /** It answered `answer`, empty when its last message holds no text. */
  | { answer: string }
  /** It's gone from Pi. */
  | { gone: true }
  /** It stopped without answering, for Pi's `reason`. */
  | { unanswered: string };

/** How a kind of agent conversation is named in the errors its tool call fails with. */
export type AgentNames = {
  /** The agent, such as "The Code Agent". */
  agent: string;
  /** What to check when it didn't answer, such as "the code". */
  work: string;
};

/**
 * One kind of agent conversation a thread runs beside its root conversation, as the Code Agent
 * and Artifact Agents are (ADR 0035): each conversation is found by a key of the kind's own,
 * started on first use with the kind's extension and model, and outlives every request, which
 * tool calls send it and wait for. Stopping the run stops them all.
 */
export class AgentConversations {
  /** The kind's extension, which the thread installs once Pi opened: none outside a draft. */
  extension: Extension | undefined;

  /** The last start of a conversation, which the next waits for: one per key. */
  readonly #starting = serialQueue();

  /** The ids of the kind's conversations, once listed. */
  #known: Set<ConversationId> | undefined;

  protected readonly storage: DurableObjectStorage;
  readonly #pi: () => Promise<Harness>;
  readonly #model: () => AgentModel;
  /** The prefix of the keys naming each conversation, followed by its key. */
  readonly #prefix: string;
  /** Why a conversation can't start, when the thread didn't install the kind's extension. */
  readonly #unavailable: string;
  readonly #names: AgentNames;

  constructor(options: AgentConversationsOptions) {
    this.storage = options.storage;
    this.#pi = options.pi;
    this.#model = options.model;
    this.#prefix = options.prefix;
    this.#unavailable = options.unavailable;
    this.#names = options.names;
  }

  /**
   * The conversation of `key`, started with the kind's extension and model, unless the thread
   * has one already. It belongs to no run: it outlives every call, which only waits for it.
   */
  async of(key: string, context: Context): Promise<ConversationId> {
    const storageKey = `${this.#prefix}${key}`;
    return this.#starting.run(async () => {
      const known = await this.storage.get<number>(storageKey);
      if (known !== undefined) return known as ConversationId;
      const extension = this.extension;
      if (!extension) throw new Error(this.#unavailable);
      const pi = await this.#pi();
      // Pi gives the defaults the harness opened with to the root alone.
      const { model, thinkingLevel } = this.#model();
      const created = await pi.createConversation(
        {
          ownership: { kind: "ownerless" },
          agent: {
            extensions: [extension],
            model: { provider: model.provider, modelId: model.id },
            thinkingLevel,
          },
        },
        context,
      );
      await this.storage.put(storageKey, created.id);
      this.#known?.add(created.id);
      return created.id;
    });
  }

  /** Whether the conversation of `key` started. */
  async started(key: string): Promise<boolean> {
    return (await this.storage.get(`${this.#prefix}${key}`)) !== undefined;
  }

  /** Whether `conversationId` is one of the kind's conversations. */
  async owns(conversationId: ConversationId): Promise<boolean> {
    this.#known ??= new Set(
      [...(await this.storage.list<number>({ prefix: this.#prefix })).values()].map(
        (id) => id as ConversationId,
      ),
    );
    return this.#known.has(conversationId);
  }

  /**
   * Sends `request` to the conversation `conversationId`, from the tool call `invocation`, and
   * waits for its answer, while `onActivity` hears what it's doing. Stopping the call stops the
   * conversation. A call that runs again waits for the same request.
   */
  async ask(
    { api, context }: ToolInvocation,
    conversationId: ConversationId,
    { requestId, text, entry }: AgentRequest,
    onActivity: (activity: AgentActivity) => Promise<void>,
  ): Promise<AgentAnswer> {
    const pi = await this.#pi();
    const agent = await api.conversation(conversationId, context);
    if (!agent) return { gone: true };
    const submission = await agent.submit(
      { type: "input", requestId, content: [{ type: "text", text }], entry },
      context,
    );
    const stream = await watchEvents(pi, conversationId, context);
    let state = reduceThreadEvents(EMPTY_THREAD_STATE, [stream.snapshot]);
    let shown: AgentActivity | undefined;
    const show = async () => {
      const { activity } = threadViewOf(state);
      if (!activity || activity === shown) return;
      shown = activity;
      await onActivity(activity).catch(() => undefined);
    };
    stream.start(async (events) => {
      state = reduceThreadEvents(state, events);
      await show();
    });
    let settled: Awaited<ReturnType<typeof submission.wait>>;
    try {
      await show();
      settled = await submission.wait(context);
    } finally {
      await stream.stop();
      if (context.abortSignal?.aborted) {
        await (await pi.conversation(conversationId, BACKGROUND))?.abort(BACKGROUND);
      }
    }
    if (settled.status !== "done") return { unanswered: settled.reason };
    const found = await (
      await pi.conversation(conversationId, context)
    )?.entries({ minEntryId: settled.answer, maxEntryId: settled.answer }, 1, undefined, context);
    const message = found?.items[0]?.model?.find(({ role }) => role === "assistant");
    return { answer: message ? textOf(message.content) : "" };
  }

  /**
   * The answer `asked` holds, or the error the tool call that asked fails with: the conversation
   * is gone, stopped without answering, or answered nothing.
   */
  answerOf(asked: AgentAnswer): string {
    const { agent, work } = this.#names;
    if ("gone" in asked) throw new Error(`${agent} is gone`);
    if ("unanswered" in asked) {
      throw new Error(
        `${agent} didn't answer (${asked.unanswered}): check ${work} before trying again.`,
      );
    }
    if (!asked.answer) throw new Error(`${agent} answered nothing: check ${work}.`);
    return asked.answer;
  }

  /**
   * Stops the kind's conversations still working, which stopping the call waiting on one stops
   * already, should one outlive it.
   */
  async stop() {
    const conversations = await this.storage.list<number>({ prefix: this.#prefix });
    const pi = await this.#pi();
    for (const id of conversations.values()) {
      await (await pi.conversation(id as ConversationId, BACKGROUND))?.abort(BACKGROUND);
    }
  }
}

/**
 * A kind of agent conversation that stores what each conversation works on (`Work`) by its id,
 * for its environment to read, as Artifact Agents store their artifact.
 */
export class AgentConversationsWithWork<Work> extends AgentConversations {
  /** The prefix of the keys holding what each conversation works on, followed by its id. */
  readonly #workPrefix: string;

  constructor(options: AgentConversationsOptions & { workPrefix: string }) {
    super(options);
    this.#workPrefix = options.workPrefix;
  }

  /** Stores what the conversation `conversationId` works on, for its environment to read. */
  async setWork(conversationId: ConversationId, work: Work) {
    await this.storage.put(`${this.#workPrefix}${conversationId}`, work);
  }

  /** What the conversation `conversationId` works on, if a request stored it. */
  async work(conversationId: ConversationId): Promise<Work | undefined> {
    return this.storage.get<Work>(`${this.#workPrefix}${conversationId}`);
  }
}
