import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/** Headers that make a server-side call look like the user's browser to the API. */
const getForwardedHeaders = createIsomorphicFn()
  .server(() => {
    const request = getRequest();
    const cookie = request.headers.get("cookie");
    if (!cookie) return undefined;
    // better-auth rejects cookie-authenticated POSTs without an Origin.
    return { cookie, origin: new URL(request.url).origin };
  })
  .client(() => undefined);

/**
 * Fetch for API calls that carries the user's session everywhere. The browser
 * sends cookies itself; during SSR we forward the incoming request's cookies,
 * so loaders can fetch authenticated data and the server renders the real page.
 */
export const apiFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const forwarded = getForwardedHeaders();
  if (!forwarded) return fetch(input, { ...init, credentials: "include" });

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  for (const [key, value] of Object.entries(forwarded)) headers.set(key, value);
  return fetch(input, { ...init, headers });
};
