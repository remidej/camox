export function getProjectRoomSessionHeaders(request: Request): Headers {
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
