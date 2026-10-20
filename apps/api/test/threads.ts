import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import {
  EMPTY_THREAD_VIEW,
  reduceThreadEvents,
  type ThreadClientMessage,
  type ThreadServerMessage,
  type ThreadView,
} from "@camox/api-contract/threads";
import { call } from "@orpc/server";
import { env } from "cloudflare:workers";

import type { createDb } from "../src/db";
import { upsertBlockDefinition } from "../src/domains/block-definitions/service";
import { blockProcedures } from "../src/domains/blocks/routes";
import { pageProcedures } from "../src/domains/pages/routes";
import app from "../src/index";
import { runService } from "../src/lib/run-service";
import { session } from "../src/schema";
import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  createServiceContext,
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

/** A connected thread socket, folding what it receives with the studio's own module. */
export type ThreadClient = {
  view: () => ThreadView;
  frames: ThreadServerMessage[];
  send: (message: ThreadClientMessage) => void;
  /** Waits until `check` holds for what the socket received. */
  until: (check: () => boolean) => Promise<void>;
  close: () => void;
};

export const connectLiveThread = async (projectId: number, token: string) =>
  connectThread(await requestLiveThread(projectId, token));

export const connectDraftThread = async (projectId: number, draft: string, token: string) =>
  connectThread(await requestDraftThread(projectId, draft, token));

async function connectThread(response: Response): Promise<ThreadClient> {
  const socket = response.webSocket;
  if (!socket) throw new Error(`The thread refused the connection (${response.status})`);
  socket.accept();

  let view = EMPTY_THREAD_VIEW;
  const frames: ThreadServerMessage[] = [];
  const waiters: (() => void)[] = [];
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const frame = JSON.parse(event.data) as ThreadServerMessage;
    frames.push(frame);
    if (frame.type === "events") view = reduceThreadEvents(view, frame.events);
    for (const wake of waiters.splice(0)) wake();
  });

  const until = async (check: () => boolean) => {
    const deadline = Date.now() + 10_000;
    while (!check()) {
      if (Date.now() > deadline) {
        throw new Error(`The thread never got there: ${JSON.stringify(view)}`);
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
    view: () => view,
    frames,
    send: (message) => socket.send(JSON.stringify(message)),
    until,
    close: () => socket.close(),
  };
}

/**
 * Sends `text` in `thread` and closes it once the agent's turn ended, returning what the thread
 * showed then.
 */
export async function ask(thread: ThreadClient, text: string): Promise<ThreadView> {
  const before = thread.view().messages.length;
  thread.send({ type: "send", operationId: crypto.randomUUID(), text });
  await thread.until(() => !thread.view().working && thread.view().messages.length >= before + 2);
  thread.close();
  return thread.view();
}

/** A project whose Live website has a page per `pages` entry, each with a text block. */
export async function websiteFixture(pages: Record<string, string>) {
  const base = await createProjectFixture(crypto.randomUUID());
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      blockId: "text",
      title: "Text",
      description: "A paragraph",
      contentSchema: {
        type: "object",
        toMarkdown: ["{{body}}"],
        properties: { body: { type: "string", fieldType: "String" } },
      },
    }),
  );
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
