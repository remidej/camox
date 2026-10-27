import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { AppEnv } from "../../types";
import { projects } from "../projects/schema";
import { artifactSources } from "./schema";

/**
 * An artifact source, by Project ID and hash (`artifactSourceHash`): what a website's Worker
 * serves artifacts from on public pages (ADR 0002). A hash names one source for good, so the edge
 * caches it for a year (src/edge-cache.ts) and nothing purges it. It's served as plain text: the
 * website wraps it in the artifact's document, and the API's origin never runs it.
 */
export const artifactSourceRoutes = new Hono<AppEnv>();

artifactSourceRoutes.get("/:projectUuid/:hash", async (c) => {
  const row = await c.var.db
    .select({ source: artifactSources.source })
    .from(artifactSources)
    .innerJoin(projects, eq(projects.id, artifactSources.projectId))
    .where(
      and(
        eq(projects.uuid, c.req.param("projectUuid")),
        eq(artifactSources.hash, c.req.param("hash")),
      ),
    )
    .get();
  // A miss isn't kept, so a source stored later isn't hidden (the edge also keeps only hits).
  if (!row) return c.json({ error: "Not found" }, 404, { "Cache-Control": "no-store" });
  return new Response(row.source, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});
