import { execSync } from "node:child_process";
import http from "node:http";

import * as p from "@clack/prompts";

import {
  type AuthToken,
  readAuthTokenForUrl,
  removeAuthTokenForUrl,
  verifyOneTimeToken,
  writeAuthTokenForUrl,
} from "./auth-core";

export type { AuthToken } from "./auth-core";
export {
  readAuthTokenForUrl,
  removeAuthTokenForUrl,
  verifyOneTimeToken,
  writeAuthTokenForUrl,
} from "./auth-core";

const CAMOX_URL = process.env.CAMOX_URL || "https://app.camox.ai";
const CAMOX_API_URL = process.env.CAMOX_API_URL || "https://api.camox.ai";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// --- Token persistence (keyed by CAMOX_URL) ---

export function readAuthToken(): AuthToken | null {
  return readAuthTokenForUrl(CAMOX_URL);
}

export function writeAuthToken(token: AuthToken): void {
  writeAuthTokenForUrl(CAMOX_URL, token);
}

export function removeAuthToken(): void {
  removeAuthTokenForUrl(CAMOX_URL);
}

// --- Browser auth flow ---

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    execSync(`${cmd} ${JSON.stringify(url)}`, { stdio: "ignore" });
  } catch {
    // Silently fail — the URL is already displayed for copy-paste
  }
}

function startCallbackServer(): Promise<{
  port: number;
  ottPromise: Promise<string>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    let resolveOtt: (token: string) => void;
    const ottPromise = new Promise<string>((res) => {
      resolveOtt = res;
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }

      const ott = url.searchParams.get("ott");
      if (!ott) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Missing token. Please try again.</h2></body></html>");
        return;
      }

      res.writeHead(302, { Location: `${CAMOX_URL}/cli-authorized` });
      res.end();
      resolveOtt(ott);
    });

    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to start callback server"));
        return;
      }
      resolve({
        port: addr.port,
        ottPromise,
        close: () => server.close(),
      });
    });

    server.on("error", reject);
  });
}

async function authenticateUser(): Promise<AuthToken> {
  const { port, ottPromise, close } = await startCallbackServer();

  const action = await p.select({
    message: "Connect to Camox",
    options: [
      { value: "signup" as const, label: "Sign up in browser" },
      { value: "login" as const, label: "Log in in browser" },
    ],
  });

  if (p.isCancel(action)) {
    close();
    throw new Error("Authentication cancelled");
  }

  const callbackUrl = `http://localhost:${port}/callback`;
  const cliAuthUrl = `/cli-authorize?callback=${encodeURIComponent(callbackUrl)}`;
  const authPage = action === "signup" ? "/signup" : "/login";
  const url = `${CAMOX_URL}${authPage}?redirect=${encodeURIComponent(cliAuthUrl)}`;

  openBrowser(url);
  p.log.info(`Browser not opening? Visit:\n${url}`);

  const s = p.spinner();
  s.start("Waiting for authentication...");

  try {
    const ott = await Promise.race([
      ottPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Authentication timed out")), AUTH_TIMEOUT_MS),
      ),
    ]);

    s.message("Verifying...");
    const authToken = await verifyOneTimeToken(CAMOX_API_URL, ott);
    writeAuthToken(authToken);

    s.stop(`Authenticated as ${authToken.name}`);
    return authToken;
  } catch (err) {
    s.error("Authentication failed.");
    throw err;
  } finally {
    close();
  }
}

/**
 * Returns a stored auth token if available and valid, otherwise runs the interactive login flow.
 */
export async function getOrAuthenticate(): Promise<AuthToken> {
  const stored = readAuthToken();
  if (stored) {
    const { verifySession } = await import("./api");
    const valid = await verifySession(stored.token);
    if (valid) {
      p.log.info(`Authenticated as ${stored.name}`);
      return stored;
    }
    removeAuthToken();
    p.log.warn("Session expired. Please log in again.");
  } else {
    p.log.info("Please connect to Camox so we can create your project on the Camox API.");
  }

  return authenticateUser();
}
