import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { edgeCachePurges, edgeCacheTags } from "../../lib/edge-cache-purges";
import type { ServiceContext } from "../_shared/service-context";
import { pages } from "./schema";

// A page's custom OG image blob belongs to the page row (Live or a draft's copy), not to the
// `files` table, so it is cleaned up here: once no page row names it.

/**
 * The custom OG image blobs a project's pages name, Live or in any draft: what may lose its last
 * reference when a draft is published or discarded. Collect them before the batch.
 */
export const ogImageBlobsOf = Effect.fn("pages.ogImageBlobsOf")(function* (
  db: Database,
  projectId: number,
) {
  const rows = yield* Effect.promise(() =>
    db
      .selectDistinct({ blobId: pages.customOgImageBlobId })
      .from(pages)
      .where(and(eq(pages.projectId, projectId), isNotNull(pages.customOgImageBlobId))),
  );
  return rows.flatMap((row) => (row.blobId ? [row.blobId] : []));
});

/** Deletes the OG image blobs among `blobIds` that no page row, Live or in any draft, names. */
export const deleteUnreferencedOgImageBlobs = Effect.fn("pages.deleteUnreferencedOgImageBlobs")(
  function* (ctx: Pick<ServiceContext, "db" | "env">, blobIds: Iterable<string>) {
    const candidates = [...new Set(blobIds)];
    if (candidates.length === 0) return;
    const named = yield* Effect.promise(() =>
      ctx.db
        .selectDistinct({ blobId: pages.customOgImageBlobId })
        .from(pages)
        .where(inArray(pages.customOgImageBlobId, candidates)),
    );
    const kept = new Set(named.map((row) => row.blobId));
    const deleted = candidates.filter((blobId) => !kept.has(blobId));
    yield* Effect.forEach(
      deleted,
      (blobId) => Effect.promise(() => ctx.env.FILES_BUCKET.delete(blobId)),
      { concurrency: "unbounded", discard: true },
    );
    // The edge would otherwise keep serving them.
    edgeCachePurges.purge(deleted.map(edgeCacheTags.file));
  },
);
