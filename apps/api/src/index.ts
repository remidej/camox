import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { partyserverMiddleware } from "hono-party";
import { cors } from "hono/cors";

import { createDb } from "./db";
import { authRoutes, createAuth } from "./domains/auth/routes";
import { fileHonoRoutes } from "./domains/files/routes";
import { pageHonoRoutes } from "./domains/pages/og-image-routes";
import { faviconHonoRoutes } from "./domains/projects/routes";
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
      "x-environment-name",
      "x-camox-client",
      "x-camox-telemetry-disabled",
    ],
    allowMethods: ["POST", "GET", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length", "Set-Better-Auth-Cookie"],
    maxAge: 600,
    credentials: true,
  }),
);

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

// Environment name middleware — reads x-environment-name header, defaults to "production"
app.use("*", async (c, next) => {
  c.set("environmentName", c.req.header("x-environment-name") || "production");
  c.set("client", c.req.header("x-camox-client") || "unknown");
  c.set("telemetryDisabled", c.req.header("x-camox-telemetry-disabled") === "1");
  await next();
});

// PartyServer — intercepts WebSocket upgrade requests for real-time invalidation
app.use(
  "*",
  partyserverMiddleware<AppEnv>({
    options: {
      onBeforeConnect: async (req, _lobby, c) => {
        const db = createDb(c.env.DB);
        const url = new URL(req.url);
        const auth = createAuth(db, c.env, url.origin);

        // WebSocket upgrades can't carry custom headers, so the client
        // sends the cross-domain auth cookie as a query parameter instead.
        const headers = new Headers(req.headers);
        const authCookie = url.searchParams.get("_authCookie");
        if (authCookie) {
          headers.set("Better-Auth-Cookie", authCookie);
        }

        const session = await auth.api.getSession({ headers });
        if (!session) return new Response("Unauthorized", { status: 401 });
      },
    },
  }),
);

// ---------------------------------------------------------------------------
// Hono routes (auth, file upload/serve)
// ---------------------------------------------------------------------------

app.route("/api/auth", authRoutes);
app.route("/files", fileHonoRoutes);
app.route("/favicons", faviconHonoRoutes);
app.route("/pages", pageHonoRoutes);

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
      environmentName: c.var.environmentName,
      client: c.var.client,
      telemetryDisabled: c.var.telemetryDisabled,
      waitUntil: (promise) => c.executionCtx.waitUntil(promise),
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
