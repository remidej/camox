import { env, waitUntil } from "cloudflare:workers";

import type { EdgeCachePurger } from "../durable-objects/edge-cache-purger";
import type { Bindings } from "../types";

// What Cloudflare caches in front of the API (`EdgeCache`, src/edge-cache.ts) is tagged, so a
// change can purge it everywhere at once. Each cached response carries its tags in `Cache-Tag`.

export const edgeCacheTags = {
  /** A project's Live cache key, which every public render of its website is cached under. */
  live: (projectId: number) => `live:${projectId}`,
  /** A stored file, served at `/files/serve/<key>`. */
  file: (key: string) => `file:${key}`,
  /** A project's favicon, served at `/favicons/<projectId>`. */
  favicon: (projectId: number) => `favicon:${projectId}`,
};

/** Where `EdgeCache` takes purges, from inside the Worker only: the gateway never forwards it. */
export const EDGE_CACHE_PURGE_URL = "https://edge-cache.internal/purge";

/**
 * Purges what the edge cached under some tags, everywhere. Purging never fails and never delays
 * the caller: the purger Durable Object batches and sends it (`EdgeCachePurger`). Tests swap in
 * a recording adapter (`test/edge-cache-purges.ts`).
 */
export interface EdgeCachePurges {
  purge(tags: readonly string[]): void;
}

/** The purges as the purger Durable Object sends them, reached from wherever the work runs. */
export const edgeCachePurges: EdgeCachePurges = {
  purge(tags) {
    if (tags.length === 0) return;
    const namespace = (env as unknown as Bindings).EDGE_CACHE_PURGER;
    const purger = namespace.get(namespace.idFromName("purger"));
    waitUntil(
      purger
        .purge([...tags])
        .catch((error: unknown) => console.error("[edge-cache] purge request failed", error)),
    );
  },
};

export type EdgeCachePurgerNamespace = DurableObjectNamespace<EdgeCachePurger>;
