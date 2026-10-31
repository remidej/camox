// Nx's remote task cache, as the HTTP server Nx talks to when NX_SELF_HOSTED_REMOTE_CACHE_SERVER
// is set (https://nx.dev/docs/guides/tasks--caching/self-hosted-caching). Each entry is the tarball
// Nx sends, stored in R2 under its task hash.

export interface Env {
  CACHE: R2Bucket;
  /** The bearer token Nx sends, from NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN. */
  ACCESS_TOKEN: string;
}

const CACHE_PATH = /^\/v1\/cache\/([A-Za-z0-9]+)$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const hash = CACHE_PATH.exec(new URL(request.url).pathname)?.[1];
    if (!hash) return new Response("Not found", { status: 404 });
    if (!(await authorized(request, env.ACCESS_TOKEN))) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (request.method === "GET") {
      const entry = await env.CACHE.get(hash);
      if (!entry) return new Response("Not found", { status: 404 });
      return new Response(entry.body, {
        headers: { "Content-Type": "application/octet-stream" },
      });
    }

    if (request.method === "PUT") {
      if (!request.body) return new Response("Missing body", { status: 400 });
      // A task's outputs never change for its hash, so the first write stands. Nx reads 409 as
      // "already stored".
      const stored = await env.CACHE.put(hash, request.body, {
        onlyIf: { etagDoesNotMatch: "*" },
      });
      if (!stored) return new Response("Already stored", { status: 409 });
      return new Response(null, { status: 200 });
    }

    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, PUT" } });
  },
};

async function authorized(request: Request, token: string): Promise<boolean> {
  const given = request.headers.get("Authorization");
  if (!token || !given) return false;
  // Comparing digests rather than the strings keeps the time taken from revealing the token.
  const [a, b] = await Promise.all(
    [given, `Bearer ${token}`].map(
      async (value) =>
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    ),
  );
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
