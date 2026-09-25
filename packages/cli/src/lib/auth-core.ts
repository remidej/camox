import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function globalAuthFile(): string {
  return path.join(os.homedir(), ".camox", "auth.json");
}

function localAuthFile(cwd: string): string | null {
  let directory = path.resolve(cwd);
  while (true) {
    // .git can be a directory or a file (linked worktrees).
    if (fs.existsSync(path.join(directory, ".git"))) {
      const file = path.join(directory, ".camox", "auth.json");
      return fs.existsSync(file) ? file : null;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export interface AuthToken {
  token: string;
  name: string;
  email: string;
}

export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function isLoopbackUrl(url: URL): boolean {
  return (
    ["http:", "https:"].includes(url.protocol) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    !url.username &&
    !url.password
  );
}

export async function createPreviewSignInUrl(
  destination: string,
  target: { projectSlug: string; environmentName: string; apiUrl: string },
  authToken: string,
  signal = AbortSignal.timeout(15_000),
): Promise<string> {
  const url = new URL(destination);
  if (!isLoopbackUrl(url)) {
    throw new Error("Preview requires an http(s) loopback URL without credentials.");
  }
  const response = await fetch(`${normalizeUrl(target.apiUrl)}/api/auth/one-time-token/generate`, {
    headers: { Authorization: `Bearer ${authToken}` },
    redirect: "error",
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `Could not create preview sign-in (${response.status}). Check your session with camox login.`,
    );
  }
  const data = (await response.json()) as { token?: unknown };
  if (typeof data.token !== "string" || !data.token) {
    throw new Error("Authentication backend returned no one-time token.");
  }
  url.searchParams.set(
    "camox-preview",
    JSON.stringify({ ...target, apiUrl: normalizeUrl(target.apiUrl) }),
  );
  url.searchParams.set("ott", data.token);
  return url.href;
}

type AuthEntries = Record<string, AuthToken | null>;

function readAllTokens(file: string): AuthEntries {
  if (!fs.existsSync(file)) return {};
  // Fail closed on malformed files instead of silently using another identity.
  const entries = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new Error(`Invalid Camox credentials file: ${file}`);
  }
  return entries;
}

function writeAllTokens(file: string, tokens: AuthEntries): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function credentialFile(authenticationUrl: string, cwd: string): string {
  const local = localAuthFile(cwd);
  if (local && Object.hasOwn(readAllTokens(local), normalizeUrl(authenticationUrl))) return local;
  return globalAuthFile();
}

/** Look up stored credentials for a specific Camox authentication backend. */
export function readAuthTokenForUrl(
  authenticationUrl: string,
  cwd = process.cwd(),
): AuthToken | null {
  const tokens = readAllTokens(credentialFile(authenticationUrl, cwd));
  const entry = tokens[normalizeUrl(authenticationUrl)];
  if (entry?.token && entry?.name && typeof entry.email === "string") return entry;
  return null;
}

export function writeAuthTokenForUrl(
  authenticationUrl: string,
  token: AuthToken,
  cwd = process.cwd(),
): void {
  const file = credentialFile(authenticationUrl, cwd);
  const tokens = readAllTokens(file);
  tokens[normalizeUrl(authenticationUrl)] = token;
  writeAllTokens(file, tokens);
}

export function removeAuthTokenForUrl(authenticationUrl: string, cwd = process.cwd()): void {
  const file = credentialFile(authenticationUrl, cwd);
  const tokens = readAllTokens(file);
  if (file !== globalAuthFile()) {
    // Keep a tombstone so logout never exposes global credentials for this URL.
    tokens[normalizeUrl(authenticationUrl)] = null;
    writeAllTokens(file, tokens);
    return;
  }
  delete tokens[normalizeUrl(authenticationUrl)];
  if (Object.keys(tokens).length > 0) {
    writeAllTokens(file, tokens);
    return;
  }
  fs.rmSync(file, { force: true });
}

export async function verifyOneTimeToken(apiUrl: string, token: string): Promise<AuthToken> {
  const res = await fetch(`${normalizeUrl(apiUrl)}/api/auth/one-time-token/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    throw new Error(`OTT verification failed: ${res.status}`);
  }

  const data: { user?: { name?: string; email?: string }; session?: { token?: string } } =
    await res.json();

  const user = data.user;
  if (!user?.name) {
    throw new Error("No user info in verification response");
  }

  const sessionToken = data.session?.token;
  if (!sessionToken) {
    throw new Error("No session token in verification response");
  }

  return { name: user.name, email: user.email ?? "", token: sessionToken };
}
