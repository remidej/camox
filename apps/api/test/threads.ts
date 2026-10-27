import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import {
  EMPTY_THREAD_STATE,
  reduceThreadFrame,
  type ThreadClientMessage,
  type ThreadSender,
  type ThreadServerMessage,
  type ThreadView,
  threadViewOf,
  type TouchedBatch,
} from "@camox/api-contract/threads";
import { call } from "@orpc/server";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";

import type { createDb } from "../src/db";
import { blockProcedures } from "../src/domains/blocks/routes";
import { draftProcedures } from "../src/domains/drafts/routes";
import { pageProcedures } from "../src/domains/pages/routes";
import type { ThreadIdentity } from "../src/domains/threads/tools";
import {
  ENDED_KEY,
  THREAD_IDENTITY_HEADER,
  THREAD_SENDER_HEADER,
} from "../src/durable-objects/thread";
import app from "../src/index";
import { drafts, session } from "../src/schema";
import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  syncDefinitionSet,
} from "./fixtures";

/** Signs `userId` in, returning the bearer token the studio would send. */
export async function signIn(db: ReturnType<typeof createDb>, userId: string) {
  const token = `session-${crypto.randomUUID()}`;
  const now = new Date();
  await db.insert(session).values({
    id: `session-id-${token}`,
    token,
    userId,
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
  });
  return token;
}

const requestThread = (path: string, token: string | null) =>
  app.request(
    path,
    {
      headers: {
        Upgrade: "websocket",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    },
    env,
  );

/** Opens the socket to the signed-in editor's Live thread in a project, as the studio does. */
export const requestLiveThread = (projectId: number, token: string | null) =>
  requestThread(`/threads/live/${projectId}`, token);

/**
 * Opens the socket to a draft's thread, as the studio does in that draft: `draft` is the draft's
 * id, or `development` for the signed-in editor's development draft.
 */
export const requestDraftThread = (projectId: number, draft: string, token: string | null) =>
  requestThread(`/threads/draft/${projectId}/${draft}`, token);

/**
 * What a draft's thread keeps in its Durable Object: the tables and keys in its storage, empty
 * until the thread exists. A draft whose thread nobody reached yet has none.
 */
export async function storedThreadOf(db: ReturnType<typeof createDb>, draftId: string) {
  const threadId = await threadIdOf(db, draftId);
  return threadId ? storedThread(threadId) : NOTHING_STORED;
}

/** What a thread that stores nothing keeps: no tables, no keys. */
export const NOTHING_STORED = { tables: [], keys: [] };

/** What a thread that ended with its draft keeps: only the record that it ended. */
export const ENDED_THREAD_STORED = { tables: [], keys: [ENDED_KEY] };

/** The id of a draft's thread, once someone opened it: null before, or once the draft ended. */
export async function threadIdOf(db: ReturnType<typeof createDb>, draftId: string) {
  const draft = await db
    .select({ threadId: drafts.threadId })
    .from(drafts)
    .where(eq(drafts.id, draftId))
    .get();
  return draft?.threadId ?? null;
}

/** What thread `threadId` keeps in its Durable Object: the tables and keys in its storage. */
export function storedThread(threadId: string) {
  return runInDurableObject(env.THREAD.getByName(threadId), async (_thread, state) => ({
    tables: state.storage.sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
      )
      .toArray()
      .map(({ name }) => name),
    keys: [...(await state.storage.list()).keys()],
  }));
}

/** How many sockets the thread a draft records has accepted, or 0 while it records none. */
export async function socketsOnThreadOf(db: ReturnType<typeof createDb>, draftId: string) {
  const draft = await db
    .select({ threadId: drafts.threadId })
    .from(drafts)
    .where(eq(drafts.id, draftId))
    .get();
  if (!draft?.threadId) return 0;
  return runInDurableObject(
    env.THREAD.getByName(draft.threadId),
    async (_thread, state) => state.getWebSockets().length,
  );
}

/**
 * Who each message in `view` is from, and its text for an editor's or the agent's, or the draft's
 * name for a draft the agent on Live started.
 */
export const said = (view: ThreadView) =>
  view.messages.map((message) => {
    if ("text" in message) return { from: message.from, text: message.text };
    if (message.from === "draft") return { from: message.from, name: message.name };
    return { from: message.from };
  });

/** The text of the last message in `view`, when it's the agent's. */
export const lastAnswer = (view: ThreadView) => {
  const message = view.messages.at(-1);
  return message?.from === "agent" ? message.text : undefined;
};

/** The touched batches a socket received, in order. */
export const touchedOf = (thread: ThreadClient): TouchedBatch[] =>
  thread.frames.flatMap((frame) => (frame.type === "touched" ? [frame.touched] : []));

/** A connected thread socket, folding what it receives with the studio's own module. */
export type ThreadClient = {
  view: () => ThreadView;
  frames: ThreadServerMessage[];
  send: (message: ThreadClientMessage) => void;
  /** Waits until `check` holds for what the socket received. */
  until: (check: () => boolean) => Promise<void>;
  /** Waits until no run is going, and the view shows `messages` messages when given. */
  untilIdle: (messages?: number) => Promise<void>;
  /** The code the thread closed the socket with, once it did. */
  closedWith: () => number | undefined;
  close: () => void;
};

export const connectLiveThread = async (projectId: number, token: string) =>
  connectThread(await requestLiveThread(projectId, token));

export const connectDraftThread = async (projectId: number, draft: string, token: string) =>
  connectThread(await requestDraftThread(projectId, draft, token));

/**
 * Opens a socket straight to thread `threadId`, as the API forwards one it authorized for
 * `sender` in `identity`: for a connection the API let through just before the thread ended,
 * which reaches it after.
 */
export const connectForwarded = async (
  threadId: string,
  sender: ThreadSender,
  identity: ThreadIdentity,
) =>
  connectThread(
    await env.THREAD.getByName(threadId).fetch("http://thread/", {
      headers: {
        Upgrade: "websocket",
        [THREAD_SENDER_HEADER]: JSON.stringify(sender),
        [THREAD_IDENTITY_HEADER]: JSON.stringify(identity),
      },
    }),
  );

async function connectThread(response: Response): Promise<ThreadClient> {
  const socket = response.webSocket;
  if (!socket) throw new Error(`The thread refused the connection (${response.status})`);
  socket.accept();

  let state = EMPTY_THREAD_STATE;
  const view = () => threadViewOf(state);
  const frames: ThreadServerMessage[] = [];
  const waiters: (() => void)[] = [];
  let closedWith: number | undefined;
  socket.addEventListener("close", (event) => {
    closedWith = event.code;
    for (const wake of waiters.splice(0)) wake();
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const frame = JSON.parse(event.data) as ThreadServerMessage;
    frames.push(frame);
    state = reduceThreadFrame(state, frame);
    for (const wake of waiters.splice(0)) wake();
  });

  const until = async (check: () => boolean) => {
    const deadline = Date.now() + 10_000;
    while (!check()) {
      if (Date.now() > deadline) {
        throw new Error(`The thread never got there: ${JSON.stringify(view())}`);
      }
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  };

  // The thread sends its snapshot first.
  await until(() => frames.some((frame) => frame.type === "events"));

  return {
    view,
    frames,
    send: (message) => socket.send(JSON.stringify(message)),
    until,
    untilIdle: (messages) =>
      until(
        () => !view().running && (messages === undefined || view().messages.length === messages),
      ),
    closedWith: () => closedWith,
    close: () => socket.close(),
  };
}

/**
 * Sends `text` in `thread` and closes it once the agent's turn ended, unless `keepOpen`,
 * returning what the thread showed then.
 */
export async function ask(
  thread: ThreadClient,
  text: string,
  {
    keepOpen = false,
    operationId = crypto.randomUUID(),
  }: { keepOpen?: boolean; operationId?: string } = {},
): Promise<ThreadView> {
  const before = thread.view().messages.length;
  thread.send({ type: "send", operationId, text });
  await thread.until(() => !thread.view().running && thread.view().messages.length >= before + 2);
  if (!keepOpen) thread.close();
  return thread.view();
}

/** The text block every page of `websiteFixture` holds. */
export const textDefinition = {
  blockId: "text",
  title: "Text",
  description: "A paragraph",
  contentSchema: {
    type: "object",
    toMarkdown: ["{{body}}"],
    properties: { body: { type: "string", fieldType: "String" } },
  },
};

/** A project whose Live website has a page per `pages` entry, each with a text block. */
export async function websiteFixture(pages: Record<string, string>) {
  const base = await createProjectFixture(crypto.randomUUID());
  await syncDefinitionSet(base.db, base.project, { blocks: [textDefinition] });
  const options = { context: createRpcContext(base.db, base.memberUser) };
  for (const [pathSegment, body] of Object.entries(pages)) {
    const { page } = await callSeedingLive(
      pageProcedures.create,
      { projectId: base.project.id, pathSegment, layoutId: base.layout.layoutId },
      options,
    );
    await callSeedingLive(
      blockProcedures.create,
      { pageId: page.id, type: "text", content: { body } } as never,
      options,
    );
  }
  return base;
}

export type Website = Awaited<ReturnType<typeof websiteFixture>>;

/**
 * A website's pages by path, each with its blocks' Markdown, as the studio reads them in
 * `draftId`, or on Live without one.
 */
export async function pagesOf({ db, memberUser, project }: Website, draftId?: string) {
  const context = createRpcContext(db, memberUser, draftId ? { [DRAFT_HEADER]: draftId } : {});
  const pages = await call(pageProcedures.list, { projectId: project.id }, { context });
  const shown: Record<string, string[]> = {};
  for (const page of pages) {
    const { blocks } = await call(
      blockProcedures.getPageMarkdown,
      { pageId: page.id },
      { context },
    );
    shown[page.fullPath] = blocks.map((block) => block.markdown);
  }
  return shown;
}

/** The website's open drafts, as the studio's drafts control lists them. */
export async function draftsOf({ db, memberUser, project }: Website) {
  const context = createRpcContext(db, memberUser);
  const { drafts } = await call(draftProcedures.list, { projectId: project.id }, { context });
  return drafts;
}
