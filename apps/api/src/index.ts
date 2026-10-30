import { DRAFT_CREATE_HEADER, DRAFT_HEADER, LOCALE_HEADER } from "@camox/api-contract/drafts";
import { RPCHandler } from "@orpc/server/fetch";
import { Effect } from "effect";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { routePartykitRequest } from "partyserver";

import { isProjectMember } from "./authorization";
import { createDb } from "./db";
import { artifactSourceRoutes } from "./domains/artifact-sources/routes";
import { authRoutes, createAuth } from "./domains/auth/routes";
import { mcpRoutes, wellKnownRoutes } from "./domains/connected-agents/routes";
import { fileHonoRoutes } from "./domains/files/routes";
import { iconRoutes } from "./domains/icons/routes";
import { pageHonoRoutes } from "./domains/pages/og-image-routes";
import { patrolEmailRoutes } from "./domains/patrol/email-routes";
import { liveCacheKeyRoutes } from "./domains/projects/live-cache-key";
import { faviconHonoRoutes } from "./domains/projects/routes";
import { threadHonoRoutes } from "./domains/threads/routes";
import { getRelayedSessionHeaders } from "./lib/relayed-session";
import { router } from "./router";
import type { AppEnv } from "./types";

export type { Router } from "./router";

// ---------------------------------------------------------------------------
// Hono app + global middleware
// ---------------------------------------------------------------------------

const app = new Hono<AppEnv>();

// Keep deployment health checks independent of authentication and sessions.
app.get("/health", async (c) => {
  c.header("Cache-Control", "no-store");
  try {
    await c.env.DB.prepare("SELECT 1").first();
    return c.json({ status: "ok" });
  } catch {
    return c.json({ status: "unavailable" }, 503);
  }
});

// Inject db into every request
app.use("*", async (c, next) => {
  c.set("db", createDb(c.env.DB));
  await next();
});

// CORS — accepts any origin (Camox sites run on arbitrary domains)
app.use(
  "*",
  cors({
    origin: (origin) => origin,
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "Better-Auth-Cookie",
      "x-camox-client",
      "x-camox-telemetry-disabled",
      DRAFT_HEADER,
      DRAFT_CREATE_HEADER,
      LOCALE_HEADER,
    ],
    allowMethods: ["POST", "GET", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length", "Set-Better-Auth-Cookie", "WWW-Authenticate"],
    maxAge: 600,
    credentials: true,
  }),
);

app.route("/icons", iconRoutes);

// Connected Agents (ADR 0030) authenticate with their own access tokens, never a session, so
// their routes come before the session middleware.
app.route("/mcp", mcpRoutes);
app.route("/.well-known", wellKnownRoutes);

// Session middleware — populates c.var.user/session
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const auth = createAuth(c.var.db, c.env, url.origin);
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", session?.user ?? null);
    c.set("session", session?.session ?? null);
  } catch (e) {
    console.error("Session lookup failed:", e);
    c.set("user", null);
    c.set("session", null);
  }
  await next();
});

// Client attribution and telemetry opt-out headers.
app.use("*", async (c, next) => {
  c.set("client", c.req.header("x-camox-client") || "unknown");
  c.set("telemetryDisabled", c.req.header("x-camox-telemetry-disabled") === "1");
  await next();
});

// The project rooms' sockets (ADR 0011). PartyServer routes `/parties/<namespace>/<name>` to any
// Durable Object binding, so only project rooms go through, and only for members of the room's
// project. Their refusals reach the client as they are, rather than falling through to the
// routes below.
app.use("*", async (c, next) => {
  const response = await routePartykitRequest(c.req.raw, c.env, {
    onBeforeConnect: async (req, lobby) => {
      if (lobby.className !== "ProjectRoom") return new Response("Not found", { status: 404 });
      // A room is named after its project's id.
      const projectId = /^[1-9]\d*$/.test(lobby.name) ? Number(lobby.name) : NaN;
      if (!Number.isSafeInteger(projectId)) return new Response("Not found", { status: 404 });

      const db = createDb(c.env.DB);
      const auth = createAuth(db, c.env, new URL(req.url).origin);

      // WebSocket upgrades can't carry custom headers, so the client
      // relays its selected cross-domain session as a query parameter.
      const session = await auth.api.getSession({ headers: getRelayedSessionHeaders(req) });
      if (!session) return new Response("Unauthorized", { status: 401 });
      // The same answer for a project that doesn't exist, so outsiders can't probe for ids.
      if (!(await Effect.runPromise(isProjectMember(db, projectId, session.user.id)))) {
        return new Response("Forbidden", { status: 403 });
      }
    },
    // Rooms are only reached over WebSockets: plain requests never reach a Durable Object.
    onBeforeRequest: () => new Response("Not found", { status: 404 }),
  });
  return response ?? next();
});

// ---------------------------------------------------------------------------
// Hono routes (auth, file upload/serve)
// ---------------------------------------------------------------------------

app.route("/api/auth", authRoutes);
app.route("/files", fileHonoRoutes);
app.route("/favicons", faviconHonoRoutes);
app.route("/live-cache-keys", liveCacheKeyRoutes);
app.route("/artifact-sources", artifactSourceRoutes);
app.route("/pages", pageHonoRoutes);
app.route("/threads", threadHonoRoutes);
app.route("/patrol-emails", patrolEmailRoutes);

// ---------------------------------------------------------------------------
// oRPC handler (all other API procedures)
// ---------------------------------------------------------------------------

const rpcHandler = new RPCHandler(router);

app.all("/rpc/*", async (c) => {
  const { matched, response } = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: {
      db: c.var.db,
      user: c.var.user,
      session: c.var.session,
      env: c.env,
      headers: c.req.raw.headers,
      client: c.var.client,
      telemetryDisabled: c.var.telemetryDisabled,
      waitUntil: (promise) => c.executionCtx.waitUntil(promise),
      apiOrigin: new URL(c.req.url).origin,
    },
  });

  if (matched) {
    return new Response(response.body, response);
  }

  return c.notFound();
});

// ---------------------------------------------------------------------------
// Error logging (development)
// ---------------------------------------------------------------------------

app.onError((err, c) => {
  console.error(`[${c.req.method}] ${c.req.path} →`, err);
  const origin = c.req.header("origin");
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
  }
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
