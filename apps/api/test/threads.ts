import {
  EMPTY_THREAD_VIEW,
  reduceThreadEvents,
  type ThreadClientMessage,
  type ThreadServerMessage,
  type ThreadView,
} from "@camox/api-contract/threads";
import { env } from "cloudflare:workers";

import type { createDb } from "../src/db";
import app from "../src/index";
import { member, session, user } from "../src/schema";

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

/** Adds another member to an organization, as a teammate of the fixture's member. */
export async function addMember(db: ReturnType<typeof createDb>, organizationId: string) {
  const id = `teammate-${crypto.randomUUID()}`;
  const now = new Date();
  const teammate = await db
    .insert(user)
    .values({
      id,
      name: "Teammate",
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  await db.insert(member).values({
    id: `membership-${id}`,
    organizationId,
    userId: id,
    role: "member",
    createdAt: now,
  });
  return teammate;
}

/** Opens the socket to the signed-in editor's Live thread in a project, as the studio does. */
export const requestLiveThread = (projectId: number, token: string | null) =>
  app.request(
    `/threads/live/${projectId}`,
    {
      headers: {
        Upgrade: "websocket",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    },
    env,
  );

/** A connected thread socket, folding what it receives with the studio's own module. */
export type ThreadClient = {
  view: () => ThreadView;
  frames: ThreadServerMessage[];
  send: (message: ThreadClientMessage) => void;
  /** Waits until `check` holds for what the socket received. */
  until: (check: () => boolean) => Promise<void>;
  close: () => void;
};

export async function connectLiveThread(projectId: number, token: string): Promise<ThreadClient> {
  const response = await requestLiveThread(projectId, token);
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
