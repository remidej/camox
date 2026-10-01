import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { ViteDevServer } from "vite-plus";

import { authPageStyles } from "../../lib/auth-page-styles";
import { verifyOneTimeToken, writeAuthTokenForUrl } from "./auth";

const CALLBACK_PATH = "/__camox/auth/callback";
const READY_PATH = "/__camox/auth/ready";
const AUTH_REQUEST_TTL_MS = 10 * 60 * 1000;

interface PendingAuthentication {
  callbackUrl: string;
  expiresAt: number;
  returnPath: string;
}

interface DevAuthenticationOptions {
  apiUrl: string;
  authenticationUrl: string;
  isAuthenticated: boolean;
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  if (normalizedHostname === "localhost" || normalizedHostname.endsWith(".localhost")) return true;
  if (normalizedHostname === "[::1]" || normalizedHostname === "::1") return true;
  return /^127(?:\.\d{1,3}){3}$/.test(normalizedHostname);
}

function getRequestOrigin(req: IncomingMessage, server: ViteDevServer): string | null {
  const host = req.headers.host;
  if (!host) return null;

  try {
    const protocol = server.config.server.https ? "https" : "http";
    const origin = new URL(`${protocol}://${host}`);
    if (!isLoopbackHostname(origin.hostname)) return null;
    return origin.origin;
  } catch {
    return null;
  }
}

function getReturnPath(req: IncomingMessage, origin: string): string {
  const url = new URL(req.url ?? "/", origin);
  return `${url.pathname}${url.search}`;
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, {
    "Cache-Control": "no-store",
    Location: location,
  });
  res.end();
}

function sendUnavailable(res: ServerResponse): void {
  res.writeHead(503, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Retry-After": "1",
  });
  res.end(JSON.stringify({ error: "Camox authentication required" }));
}

function sendRestartingPage(res: ServerResponse, returnPath: string): void {
  const serializedReturnPath = JSON.stringify(returnPath).replaceAll("<", "\\u003c");
  res.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
  });
  res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connecting to Camox…</title>
    <style>${authPageStyles}</style>
  </head>
  <body>
    <main class="camox-auth-page" role="status"><div class="camox-auth-spinner" aria-hidden="true"></div><p>Starting your Camox site…</p></main>
    <script>
      const returnPath = ${serializedReturnPath};
      async function waitUntilReady() {
        try {
          const response = await fetch("${READY_PATH}", { cache: "no-store" });
          if (response.ok) {
            window.location.replace(returnPath);
            return;
          }
        } catch {}
        window.setTimeout(waitUntilReady, 250);
      }
      window.setTimeout(waitUntilReady, 250);
    </script>
  </body>
</html>`);
}

export function installDevAuthenticationMiddleware(
  server: ViteDevServer,
  options: DevAuthenticationOptions,
): void {
  const pendingAuthentications = new Map<string, PendingAuthentication>();
  let loggedAuthorizationUrl = false;

  server.middlewares.use((req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");

    if (requestUrl.pathname === READY_PATH) {
      if (!options.isAuthenticated) {
        sendUnavailable(res);
        return;
      }
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }

    if (options.isAuthenticated) {
      next();
      return;
    }

    if (requestUrl.pathname === CALLBACK_PATH) {
      if (req.method !== "GET") {
        res.writeHead(405, { Allow: "GET" });
        res.end();
        return;
      }
      void handleAuthenticationCallback(req, res, server, options, pendingAuthentications);
      return;
    }

    const acceptsHtml = req.headers.accept?.includes("text/html") ?? false;
    if (req.method !== "GET" || !acceptsHtml) {
      sendUnavailable(res);
      return;
    }

    const origin = getRequestOrigin(req, server);
    if (!origin) {
      res.writeHead(400, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Open this Camox development server through localhost to authenticate.");
      return;
    }

    const now = Date.now();
    for (const [state, pending] of pendingAuthentications) {
      if (pending.expiresAt < now) pendingAuthentications.delete(state);
    }

    const state = randomBytes(32).toString("hex");
    const callbackUrl = new URL(CALLBACK_PATH, origin);
    callbackUrl.searchParams.set("state", state);
    pendingAuthentications.set(state, {
      callbackUrl: callbackUrl.toString(),
      expiresAt: now + AUTH_REQUEST_TTL_MS,
      returnPath: getReturnPath(req, origin),
    });

    const authorizationUrl = new URL(
      "/dev-authorize",
      `${normalizeUrl(options.authenticationUrl)}/`,
    );
    authorizationUrl.searchParams.set("callback", callbackUrl.toString());
    if (!loggedAuthorizationUrl) {
      server.config.logger.info(`Camox authentication required: ${authorizationUrl}`, {
        timestamp: true,
      });
      loggedAuthorizationUrl = true;
    }
    redirect(res, authorizationUrl.toString());
  });

  // Nitro's early document middleware otherwise handles page requests before
  // regular Vite middleware. Keep the Camox gate directly in front of it so
  // authenticated requests can still continue through Nitro's normal path.
  const authenticationLayer = server.middlewares.stack.at(-1);
  const nitroMiddlewareIndex = server.middlewares.stack.findIndex(
    (layer) => typeof layer.handle === "function" && layer.handle.name === "nitroDevMiddlewarePre",
  );
  if (authenticationLayer && nitroMiddlewareIndex >= 0) {
    server.middlewares.stack.pop();
    server.middlewares.stack.splice(nitroMiddlewareIndex, 0, authenticationLayer);
  }
}

async function handleAuthenticationCallback(
  req: IncomingMessage,
  res: ServerResponse,
  server: ViteDevServer,
  options: DevAuthenticationOptions,
  pendingAuthentications: Map<string, PendingAuthentication>,
): Promise<void> {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const state = requestUrl.searchParams.get("state");
  const ott = requestUrl.searchParams.get("ott");
  const pending = state ? pendingAuthentications.get(state) : undefined;

  if (!state || !ott || !pending || pending.expiresAt < Date.now()) {
    if (state) pendingAuthentications.delete(state);
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("This Camox authentication request is invalid or has expired. Reload the local site.");
    return;
  }

  try {
    const authToken = await verifyOneTimeToken(options.apiUrl, ott);
    writeAuthTokenForUrl(options.authenticationUrl, authToken);
    pendingAuthentications.delete(state);
    server.config.logger.info(`Authenticated with Camox as ${authToken.email || authToken.name}.`, {
      timestamp: true,
    });
    res.once("finish", () => {
      setTimeout(() => {
        void server.restart().catch((error: unknown) => {
          server.config.logger.error(
            `Unable to restart the Camox development server: ${String(error)}`,
            { timestamp: true },
          );
        });
      }, 25);
    });
    sendRestartingPage(res, pending.returnPath);
  } catch (error) {
    server.config.logger.error(`Camox authentication failed: ${String(error)}`, {
      timestamp: true,
    });
    const authorizationUrl = new URL(
      "/dev-authorize",
      `${normalizeUrl(options.authenticationUrl)}/`,
    );
    authorizationUrl.searchParams.set("callback", pending.callbackUrl);
    authorizationUrl.searchParams.set("error", "callback_failed");
    redirect(res, authorizationUrl.toString());
  }
}
