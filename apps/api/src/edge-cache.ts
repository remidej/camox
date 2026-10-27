import { WorkerEntrypoint } from "cloudflare:workers";

import app from "./index";
import { EDGE_CACHE_PURGE_URL } from "./lib/edge-cache-purges";
import type { Bindings } from "./types";

// The API's public reads, cached by Cloudflare in front of the Worker (Workers Caching): stored
// files, favicons, each project's Live cache key, and its artifact sources. Only the `EdgeCache` entrypoint has caching
// enabled (wrangler.jsonc `exports`); the default entrypoint stays uncached and forwards these
// reads to it. Cloudflare answers a hit without running the Worker, slices Range requests out of
// the full response it stored, and answers HEAD from the GET entry. What it keeps is purged by
// tag (`edgeCachePurges`).

const EDGE_CACHED_PATHS = [
  /^\/files\/serve\/.+/,
  /^\/favicons\/[^/]+$/,
  /^\/live-cache-keys\/[^/]+$/,
  /^\/artifact-sources\/[^/]+\/[^/]+$/,
] as const;

/** Whether a request is a public read the edge caches. */
export function isEdgeCached(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const { pathname } = new URL(request.url);
  return EDGE_CACHED_PATHS.some((path) => path.test(pathname));
}

/**
 * The request as the cache sees it: without credentials, which public reads never use. A request
 * with `Authorization` would bypass the cache.
 */
export function withoutCredentials(request: Request): Request {
  const forwarded = new Request(request);
  for (const header of ["Authorization", "Cookie", "Better-Auth-Cookie"]) {
    forwarded.headers.delete(header);
  }
  return forwarded;
}

/** A response the cache may keep only when it found what was asked for. */
function keptOnlyWhenFound(response: Response): Response {
  if (response.status === 200 && response.headers.has("Cache-Control")) return response;
  const answered = new Response(response.body, response);
  answered.headers.set("Cache-Control", "no-store");
  return answered;
}

export class EdgeCache extends WorkerEntrypoint<Bindings> {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "POST" && request.url === EDGE_CACHE_PURGE_URL) {
      const { tags } = (await request.json()) as { tags: string[] };
      // Local development caches nothing, and has nothing to purge.
      const result = (await this.ctx.cache?.purge({ tags })) ?? { success: true, errors: [] };
      return Response.json(result);
    }
    return keptOnlyWhenFound(await app.fetch(request, this.env, this.ctx));
  }
}
