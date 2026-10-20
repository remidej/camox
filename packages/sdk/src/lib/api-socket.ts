import { getAuthCookieHeader } from "./auth";

/**
 * PartySocket options reaching the API at `apiUrl` as the signed-in editor. WebSocket upgrades
 * can't carry custom headers, so the session is relayed in the query.
 */
export function apiSocketOptions(apiUrl: string) {
  return {
    host: apiUrl.replace(/^https?:\/\//, "").replace(/\/+$/, ""),
    // Match the API transport instead of PartySocket's hostname-based guess:
    // custom *.localhost names otherwise default to TLS against our HTTP server.
    protocol: new URL(apiUrl).protocol === "http:" ? ("ws" as const) : ("wss" as const),
    query: () => ({ _authCookie: getAuthCookieHeader() }),
  };
}
