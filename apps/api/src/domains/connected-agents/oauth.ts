import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { isPrivateOrLocalHost } from "agents/webfetch";
import { jwt } from "better-auth/plugins";

import type { Bindings } from "../../types";

/**
 * The scopes a Connected Agent is granted, together, on one consent screen (ADR 0030): reading
 * the website, and starting and continuing drafts.
 */
export const WEBSITE_SCOPE = "website:read";
export const DRAFTS_SCOPE = "drafts:write";
export const CONNECTED_AGENT_SCOPES = [WEBSITE_SCOPE, DRAFTS_SCOPE] as const;

/**
 * What a Connected Agent asks for when it connects: the two scopes, and refresh tokens, which
 * Better Auth only issues with `offline_access`, so members stay connected for weeks.
 */
export const REQUESTED_SCOPES = [...CONNECTED_AGENT_SCOPES, "offline_access"];

/** The MCP server's canonical URI, which its tokens are bound to (RFC 8707). */
export const mcpResourceOf = (apiOrigin: string) => `${apiOrigin}/mcp`;

/** Where Better Auth serves the authorization server, as `createAuth` mounts it. */
export const issuerOf = (apiOrigin: string) => `${apiOrigin}/api/auth`;

/**
 * Whether the API at `apiOrigin` serves the MCP server. Its URI must be HTTPS, or plain HTTP on
 * `localhost` or a loopback IP: a `*.localhost` worktree host has no MCP server.
 */
export function servesMcp(apiOrigin: string) {
  const { protocol, hostname } = new URL(apiOrigin);
  return protocol === "https:" || hostname === "localhost" || /^127(\.\d+){3}$/.test(hostname);
}

const METADATA_DOCUMENT_TIMEOUT_MS = 5_000;
const METADATA_DOCUMENT_MAX_BYTES = 5 * 1024;

/**
 * Fetches a Client ID Metadata Document, or a resource it names, on Workers. As file uploads do,
 * it refuses private and special-use addresses, and it refuses redirects. Workers can't resolve
 * a name before fetching it, so the check reads the host as the URL names it.
 */
export const fetchClientMetadataDocument: ClientMetadataResourceFetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.protocol !== "https:" || isPrivateOrLocalHost(url.hostname)) {
    throw new Error("A client metadata document must be at a public HTTPS address");
  }
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(METADATA_DOCUMENT_TIMEOUT_MS),
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error("A client metadata document can't redirect");
  }
  const body = await response.arrayBuffer();
  if (body.byteLength > METADATA_DOCUMENT_MAX_BYTES) {
    throw new Error("A client metadata document is too large");
  }
  return new Response(body, { status: response.status, headers: response.headers });
};

/**
 * Better Auth's plugins that make the API the OAuth 2.1 authorization server Connected Agents
 * sign in through: `jwt()` signs the access tokens, `mcp()` issues them for the MCP server, and
 * `cimd()` registers clients from their Client ID Metadata Documents. Dynamic Client
 * Registration stays on as a fallback. Signing in and consenting happen in the Dashboard.
 */
export function connectedAgentPlugins(env: Bindings, apiOrigin: string) {
  if (!servesMcp(apiOrigin)) return [];
  return [
    jwt(),
    mcp({
      resource: mcpResourceOf(apiOrigin),
      loginPage: new URL("/connect-agent", env.DASHBOARD_URL).href,
      consentPage: new URL("/connect-agent/consent", env.DASHBOARD_URL).href,
      scopes: [...REQUESTED_SCOPES],
      clientRegistrationDefaultScopes: [...REQUESTED_SCOPES],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
    }),
    cimd({
      fetchClientMetadataResource: fetchClientMetadataDocument,
      metadataProfile: "mcp-2026-07-28",
    }),
  ];
}
