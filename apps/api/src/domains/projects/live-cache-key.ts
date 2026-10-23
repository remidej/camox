import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { edgeCacheTags } from "../../lib/edge-cache-purges";
import type { AppEnv } from "../../types";
import { projects } from "./schema";

/**
 * A backstop only: a purge clears the key the moment Live changes. Past this, a key whose purge
 * never landed is replaced anyway.
 */
const LIVE_CACHE_KEY_MAX_AGE = 24 * 60 * 60;

/**
 * A project's Live cache key, by Project ID: what websites cache their public renders under. The
 * edge caches it (src/edge-cache.ts), and any change to Live purges it (`announce`), so the next
 * read mints a new key and every render cached under the old one is left behind. Nothing stores
 * a key: one is minted whenever the edge has none, so renders are only cached under a key minted
 * after Live last changed.
 */
export const liveCacheKeyRoutes = new Hono<AppEnv>();

liveCacheKeyRoutes.get("/:projectUuid", async (c) => {
  const project = await c.var.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.uuid, c.req.param("projectUuid")))
    .get();
  if (!project) return c.json({ error: "Not found" }, 404);
  return new Response(crypto.randomUUID(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": `public, max-age=${LIVE_CACHE_KEY_MAX_AGE}`,
      "Cache-Tag": edgeCacheTags.live(project.id),
    },
  });
});
