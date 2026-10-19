/**
 * Browsers resolve any `*.localhost` name to loopback, but the Workers runtime asks the
 * OS, which need not. Local dev servers (like the per-checkout API) use such names, so
 * the dev worker reaches them on 127.0.0.1 instead.
 */
export function fetchLocalhostOnLoopback(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (!url.hostname.endsWith(".localhost")) return fetch(request);
    url.hostname = "127.0.0.1";
    return fetch(new Request(url, request));
  };
}
