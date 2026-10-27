import type { ThreadSender } from "@camox/api-contract/threads";
import { Effect } from "effect";
import { type Context, Hono } from "hono";

import { isProjectMember } from "../../authorization";
import { THREAD_IDENTITY_HEADER, THREAD_SENDER_HEADER } from "../../durable-objects/thread";
import { draftRequestNamed } from "../../lib/draft-request";
import { getRelayedSessionHeaders } from "../../lib/relayed-session";
import { respondToService, routeServiceContext } from "../../lib/route-service";
import type { AppEnv } from "../../types";
import type { ServiceContext } from "../_shared/service-context";
import { createAuth } from "../auth/routes";
import { currentLiveThread, draftThread } from "./service";
import type { ThreadIdentity } from "./tools";

export const threadHonoRoutes = new Hono<AppEnv>();

type User = NonNullable<ServiceContext["user"]>;

/** The editor signed in on a thread socket's upgrade, which relays the studio's session. */
async function signedInEditor(c: Context<AppEnv>): Promise<User | null> {
  // WebSocket upgrades can't carry custom headers, so the studio relays its session in the query,
  // as for the project room.
  const auth = createAuth(c.var.db, c.env, new URL(c.req.url).origin);
  const session = await auth.api.getSession({ headers: getRelayedSessionHeaders(c.req.raw) });
  return session?.user ?? null;
}

/** Forwards the upgrade to thread `threadId`, naming its sender and what the API authorized. */
function forward(c: Context<AppEnv>, threadId: string, user: User, identity: ThreadIdentity) {
  const sender: ThreadSender = { id: user.id, name: user.name, image: user.image ?? null };
  const headers = new Headers(c.req.raw.headers);
  headers.set(THREAD_SENDER_HEADER, JSON.stringify(sender));
  // Every header the thread trusts is the API's: one the studio sent is replaced.
  headers.set(THREAD_IDENTITY_HEADER, JSON.stringify(identity));
  return c.env.THREAD.getByName(threadId).fetch(new Request(c.req.raw, { headers }));
}

/**
 * The socket to the signed-in editor's Live thread in a project. Only project members
 * connect, and each only ever reaches their own Live thread.
 */
threadHonoRoutes.get("/live/:projectId", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") return c.text("Expected a WebSocket", 426);
  const projectId = Number(c.req.param("projectId"));
  if (!Number.isSafeInteger(projectId)) return c.text("Not found", 404);

  const user = await signedInEditor(c);
  if (!user) return c.text("Unauthorized", 401);
  if (!(await Effect.runPromise(isProjectMember(c.var.db, projectId, user.id)))) {
    return c.text("Forbidden", 403);
  }

  const { threadId } = await Effect.runPromise(currentLiveThread(c.var.db, projectId, user.id));
  return forward(c, threadId, user, { projectId, draftId: null, ownerId: user.id });
});

/**
 * The socket to a draft's thread, which `draft` names as the studio's draft header does: a
 * draft's id, or `development` for the editor's development draft. Every member who can access
 * the draft connects to the same thread, which starts with the first message; a development
 * draft's thread reaches its developer only.
 */
threadHonoRoutes.get("/draft/:projectId/:draft", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") return c.text("Expected a WebSocket", 426);
  const projectId = Number(c.req.param("projectId"));
  const draft = draftRequestNamed(c.req.param("draft"), false);
  if (!Number.isSafeInteger(projectId) || !draft) return c.text("Not found", 404);

  const user = await signedInEditor(c);
  if (!user) return c.text("Unauthorized", 401);
  return respondToService(
    c,
    draftThread(routeServiceContext(c, user, draft), projectId),
    ({ draft: opened, threadId }) =>
      forward(c, threadId, user, { projectId, draftId: opened.id, ownerId: null }),
  );
});
