import { env } from "cloudflare:workers";
import { expect } from "vite-plus/test";

import app from "../src/index";
import { createSessionFixture } from "./fixtures";

/** The API's origin in tests: the MCP server is `${API}/mcp`. */
export const API = "http://localhost";
export const MCP_URL = `${API}/mcp`;

/** The host of the fake website Connected Agents' metadata documents and callbacks are on. */
const AGENT_HOST = "website.camox.test";
export const AGENT_REDIRECT_URI = `https://${AGENT_HOST}/callback`;

/**
 * A Client ID Metadata Document URL the fake website serves (test/release-fakes.js), for a
 * Connected Agent named `clientName`.
 */
export const clientMetadataUrl = (clientName: string) =>
  `https://${AGENT_HOST}/clients/${encodeURIComponent(clientName)}`;

const request = (url: string, init: RequestInit = {}) => app.request(url, init, env);

const base64Url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

/** Where a Connected Agent learns how to connect, starting from a `401` of the MCP server. */
export async function discover() {
  const unauthorized = await request(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(unauthorized.status).toBe(401);
  const challenge = unauthorized.headers.get("www-authenticate") ?? "";
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)![1]!;
  const scope = /scope="([^"]+)"/.exec(challenge)?.[1] ?? "";
  const resource = (await (await request(metadataUrl)).json()) as {
    resource: string;
    authorization_servers: string[];
  };
  const issuerPath = new URL(resource.authorization_servers[0]!).pathname;
  const server = (await (
    await request(`${API}/.well-known/oauth-authorization-server${issuerPath}`)
  ).json()) as {
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint?: string;
  };
  return { resource: resource.resource, scope, server };
}

export type ConnectOptions = {
  /** What the Connected Agent calls itself. */
  clientName?: string;
  /**
   * How it registers: with a Client ID Metadata Document at `clientId` (by default the fake
   * website's document for `clientName`), or through Dynamic Client Registration.
   */
  registration?: "metadata-document" | "dynamic";
  clientId?: string;
  /** The scopes it asks for: those the server's challenge names, by default. */
  scope?: string;
};

/** A Connected Agent's client id: its metadata document's URL, or one the server registered. */
async function clientIdFor(
  { registration = "metadata-document", clientName = "Claude", clientId }: ConnectOptions,
  registrationEndpoint: string | undefined,
) {
  if (registration === "metadata-document") return clientId ?? clientMetadataUrl(clientName);
  const response = await request(registrationEndpoint!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [AGENT_REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

/**
 * Starts the authorization of a Connected Agent as the member signed in with `sessionToken`, as
 * the member's browser would: the response redirects to the consent screen, or refuses.
 */
export async function authorize(sessionToken: string, options: ConnectOptions = {}) {
  const { resource, scope, server } = await discover();
  const clientId = await clientIdFor(options, server.registration_endpoint);
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const url = new URL(server.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: AGENT_REDIRECT_URI,
    scope: options.scope ?? scope,
    state: crypto.randomUUID(),
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
  }).toString();
  const response = await request(url.href, {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  return { response, clientId, verifier, resource, tokenEndpoint: server.token_endpoint };
}

type Tokens = { access_token: string; refresh_token?: string; scope: string };

/**
 * Connects a Connected Agent for the member `userId` through the real OAuth flow: discovery from
 * the MCP server's `401`, authorization with a Client ID Metadata Document (or Dynamic Client
 * Registration), consent, and the token exchange. Returns its tokens, and the consent screen's
 * URL, as the authorization server sent the member there.
 */
export async function connectAgent(userId: string, options: ConnectOptions = {}) {
  const sessionToken = await createSessionFixture(userId);
  const { response, clientId, verifier, resource, tokenEndpoint } = await authorize(
    sessionToken,
    options,
  );
  expect(response.status).toBe(302);
  const consentPage = new URL(response.headers.get("location")!);

  const consent = await request(`${API}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ accept: true, oauth_query: consentPage.search.slice(1) }),
  });
  expect(consent.status).toBe(200);
  const { url: callback } = (await consent.json()) as { url: string };
  const code = new URL(callback).searchParams.get("code")!;

  const tokens = await requestTokens(tokenEndpoint, {
    grant_type: "authorization_code",
    code,
    redirect_uri: AGENT_REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
    resource,
  });
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    clientId,
    consentPage,
    sessionToken,
    /** Trades the refresh token for new tokens, as a Connected Agent does once its token expires. */
    refresh: (refreshToken = tokens.refresh_token!) =>
      requestTokens(tokenEndpoint, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        resource,
      }),
  };
}

async function requestTokens(tokenEndpoint: string, form: Record<string, string>) {
  const response = await request(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as Tokens;
}

type JsonRpcResponse = {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};
type JsonRpcMessage = JsonRpcResponse | { method: string; params?: Record<string, unknown> };

/**
 * Sends one MCP request to the server with `accessToken`, as a Connected Agent does over
 * Streamable HTTP. Returns the HTTP response, its JSON-RPC answer when there is one, and the
 * methods of the notifications the server sent before it.
 */
export async function mcpRequest(
  accessToken: string | null,
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await request(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await response.text();
  // A response streamed as server-sent events carries one message per `data:` line, its answer
  // last; any before it are notifications sent along the way.
  const data = response.headers.get("content-type")?.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length))
    : [text];
  const messages = data.flatMap((line) => {
    try {
      return line ? [JSON.parse(line) as JsonRpcMessage] : [];
    } catch {
      return [];
    }
  });
  const message = messages.findLast((sent) => !("method" in sent)) as JsonRpcResponse | undefined;
  const notifications = messages.flatMap((sent) => ("method" in sent ? [sent.method] : []));
  return { response, message, notifications };
}

type Tool = { name: string; inputSchema: { properties?: Record<string, unknown> } };

/** The tools the server lists for the member `accessToken` acts as. */
export async function listTools(accessToken: string) {
  const { message } = await mcpRequest(accessToken, "tools/list");
  expect(message?.error).toBeUndefined();
  return (message!.result as { tools: Tool[] }).tools;
}

export type ToolResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};

/** Calls a tool as a Connected Agent, failing the test when the request itself fails. */
export async function callTool(
  accessToken: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { response, message } = await mcpRequest(accessToken, "tools/call", {
    name,
    arguments: args,
  });
  expect(response.status).toBe(200);
  expect(message?.error).toBeUndefined();
  return message!.result as ToolResult;
}

/** The revision of MCP that modern Connected Agents speak, with no `initialize`. */
const MODERN_REVISION = "2026-07-28";

/**
 * Opens a `subscriptions/listen` stream, as a modern Connected Agent does to hear that its tools
 * changed. Resolves once the server acknowledged it; `next(method)` waits for the next
 * notification with that method.
 */
export async function listen(accessToken: string) {
  const aborted = new AbortController();
  const response = await request(MCP_URL, {
    method: "POST",
    signal: aborted.signal,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
      "mcp-protocol-version": MODERN_REVISION,
      "mcp-method": "subscriptions/listen",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "subscriptions/listen",
      params: {
        notifications: { toolsListChanged: true },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MODERN_REVISION,
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  const next = async (method: string) => {
    for (;;) {
      const lines = buffered.split("\n");
      const index = lines.findIndex((line) => line.startsWith("data:") && line.includes(method));
      if (index >= 0) {
        buffered = lines.slice(index + 1).join("\n");
        return JSON.parse(lines[index]!.slice("data:".length)) as { method: string };
      }
      const { value, done } = await reader.read();
      if (done) throw new Error(`The stream ended before ${method}`);
      buffered += value;
    }
  };
  await next("notifications/subscriptions/acknowledged");
  return {
    next,
    close: () => {
      aborted.abort();
      return reader.cancel().catch(() => undefined);
    },
  };
}
