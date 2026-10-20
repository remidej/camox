import type { ThreadSender } from "@camox/api-contract/threads";
import { Effect } from "effect";
import { Hono } from "hono";

import { isProjectMember } from "../../authorization";
import { THREAD_IDENTITY_HEADER, THREAD_SENDER_HEADER } from "../../durable-objects/thread";
import { getRelayedSessionHeaders } from "../../lib/relayed-session";
import type { AppEnv } from "../../types";
import { createAuth } from "../auth/routes";
import { currentLiveThread } from "./service";
import type { ThreadIdentity } from "./tools";

export const threadHonoRoutes = new Hono<AppEnv>();

/**
 * The socket to the signed-in editor's current Live thread in a project. Only project members
 * connect, and each only ever reaches their own Live thread.
 */
threadHonoRoutes.get("/live/:projectId", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") return c.text("Expected a WebSocket", 426);
  const projectId = Number(c.req.param("projectId"));
  if (!Number.isSafeInteger(projectId)) return c.text("Not found", 404);

  // WebSocket upgrades can't carry custom headers, so the studio relays its session in the query,
  // as for the project room.
  const auth = createAuth(c.var.db, c.env, new URL(c.req.url).origin);
  const session = await auth.api.getSession({ headers: getRelayedSessionHeaders(c.req.raw) });
  if (!session) return c.text("Unauthorized", 401);
  const { user } = session;
  if (!(await Effect.runPromise(isProjectMember(c.var.db, projectId, user.id)))) {
    return c.text("Forbidden", 403);
  }

  const threadId = await Effect.runPromise(currentLiveThread(c.var.db, projectId, user.id));
  const sender: ThreadSender = { id: user.id, name: user.name, image: user.image ?? null };
  const headers = new Headers(c.req.raw.headers);
  headers.set(THREAD_SENDER_HEADER, JSON.stringify(sender));
  const identity: ThreadIdentity = { projectId, ownerId: user.id };
  headers.set(THREAD_IDENTITY_HEADER, JSON.stringify(identity));
  return c.env.THREAD.getByName(threadId).fetch(new Request(c.req.raw, { headers }));
});
