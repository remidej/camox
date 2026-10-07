import { queryKeys } from "@camox/api-contract/query-keys";
import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { Context } from "hono";
import { Hono } from "hono";

import { assertPageAccess } from "../../authorization";
import type { Database } from "../../db";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import type { ForbiddenError, NotFoundError } from "../../lib/errors";
import type { AppEnv } from "../../types";
import { pages } from "./schema";

// --- Hono routes (multipart upload for the per-page custom OG image) ---
//
// The custom OG image lives only on the page row, NOT in the `files` table —
// so it never surfaces in the media library and can't be reused elsewhere.
// We reuse `/files/serve/:key` to stream the blob back since that handler is
// table-agnostic (it just reads from R2 by key).
//
// Kept in a sibling file to avoid pulling `pages/service.ts` into the import
// graph from `index.ts` — doing so reshuffles esbuild's bundle order and
// trips a TDZ on `createPageInput` (used by ai-tools' `pages` provider).

// Social platforms (Open Graph, Twitter Card) only reliably render these
// formats. SVG/AVIF/BMP/TIFF get dropped or replaced with a placeholder.
const OG_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export const pageHonoRoutes = new Hono<AppEnv>();

const deleteOgBlobIfUnreferenced = Effect.fn("deleteOgBlobIfUnreferenced")(function* (
  db: Database,
  bucket: R2Bucket,
  blobId: string,
  excludingPageId: number,
) {
  // Env replication copies the blobId across envs, so only drop the R2 object
  // when no other page row still references it.
  const sibling = yield* Effect.promise(() =>
    db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.customOgImageBlobId, blobId), sql`${pages.id} != ${excludingPageId}`))
      .limit(1)
      .get(),
  );
  if (!sibling) yield* Effect.promise(() => bucket.delete(blobId));
});

function respondToAccessErrors<A>(
  c: Context<AppEnv>,
  effect: Effect.Effect<A, NotFoundError | ForbiddenError>,
) {
  return effect.pipe(
    Effect.catchTags({
      NotFoundError: () => Effect.succeed(c.json({ error: "Not found" }, 404)),
      ForbiddenError: () => Effect.succeed(c.json({ error: "Forbidden" }, 403)),
    }),
  );
}

pageHonoRoutes.post("/:id/og-image", async (c) => {
  const user = c.var.user;
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const pageId = Number(c.req.param("id"));
  if (!pageId || Number.isNaN(pageId)) return c.json({ error: "Invalid page id" }, 400);

  const program = Effect.gen(function* () {
    const access = yield* assertPageAccess(c.var.db, pageId, user.id);

    const body = yield* Effect.promise(() => c.req.parseBody());
    const file = body["file"];
    if (!(file instanceof File)) return c.json({ error: "Missing file" }, 400);
    if (!OG_IMAGE_MIME_TYPES.has(file.type)) {
      return c.json({ error: "Image must be JPEG, PNG, GIF, or WebP" }, 400);
    }

    const now = Date.now();
    const key = `${access.page.projectId}/page-og/${pageId}-${now}-${file.name}`;

    yield* Effect.promise(() =>
      c.env.FILES_BUCKET.put(key, file.stream(), {
        httpMetadata: { contentType: file.type },
      }),
    );

    const apiOrigin = new URL(c.req.url).origin;
    const url = `${apiOrigin}/files/serve/${key}`;

    const prevBlobId = access.page.customOgImageBlobId;

    const result = yield* Effect.promise(() =>
      c.var.db
        .update(pages)
        .set({ customOgImageBlobId: key, customOgImageUrl: url, updatedAt: now })
        .where(eq(pages.id, pageId))
        .returning()
        .get(),
    );

    if (prevBlobId && prevBlobId !== key) {
      yield* deleteOgBlobIfUnreferenced(c.var.db, c.env.FILES_BUCKET, prevBlobId, pageId);
    }

    broadcastInvalidation({
      waitUntil: (p) => c.executionCtx.waitUntil(p),
      projectRoomNamespace: c.env.ProjectRoom,
      projectId: access.page.projectId,
      targets: [
        queryKeys.pages.list,
        queryKeys.pages.getById(pageId),
        queryKeys.pages.getByPathAll,
      ],
    });

    return c.json(result, 200);
  });

  return Effect.runPromise(respondToAccessErrors(c, program));
});

pageHonoRoutes.delete("/:id/og-image", async (c) => {
  const user = c.var.user;
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const pageId = Number(c.req.param("id"));
  if (!pageId || Number.isNaN(pageId)) return c.json({ error: "Invalid page id" }, 400);

  const program = Effect.gen(function* () {
    const access = yield* assertPageAccess(c.var.db, pageId, user.id);

    const blobId = access.page.customOgImageBlobId;
    if (!blobId) return c.json({ ok: true });

    const result = yield* Effect.promise(() =>
      c.var.db
        .update(pages)
        .set({ customOgImageBlobId: null, customOgImageUrl: null, updatedAt: Date.now() })
        .where(eq(pages.id, pageId))
        .returning()
        .get(),
    );

    yield* deleteOgBlobIfUnreferenced(c.var.db, c.env.FILES_BUCKET, blobId, pageId);

    broadcastInvalidation({
      waitUntil: (p) => c.executionCtx.waitUntil(p),
      projectRoomNamespace: c.env.ProjectRoom,
      projectId: access.page.projectId,
      targets: [
        queryKeys.pages.list,
        queryKeys.pages.getById(pageId),
        queryKeys.pages.getByPathAll,
      ],
    });

    return c.json(result, 200);
  });

  return Effect.runPromise(respondToAccessErrors(c, program));
});
