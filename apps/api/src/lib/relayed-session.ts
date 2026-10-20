/**
 * A WebSocket upgrade's headers, with the session the studio relays in its `_authCookie` query
 * parameter: upgrades can't carry custom headers. The project room and threads use it.
 */
export function getRelayedSessionHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  const relayedCookie = new URL(request.url).searchParams.get("_authCookie");
  if (!relayedCookie) return headers;

  // Browsers always attach first-party cookies to WebSocket handshakes. On
  // localhost those cookies are shared across ports, so another checkout can
  // contribute a stale session with the same name. The explicitly relayed
  // session is the one selected by this SDK instance and must be authoritative.
  headers.set("Cookie", relayedCookie);
  headers.delete("Better-Auth-Cookie");
  return headers;
}
