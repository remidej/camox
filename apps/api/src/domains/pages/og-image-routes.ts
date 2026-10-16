import { uuidv7Schema } from "@camox/api-contract/ids";
import { queryKeys } from "@camox/api-contract/query-keys";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { Hono } from "hono";

import { assertPageAccess, requireUser } from "../../authorization";
import type { Database } from "../../db";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { NotFoundError } from "../../lib/errors";
import { respondToUpload, uploadContextOf } from "../../lib/upload-request";
import type { AppEnv } from "../../types";
import type { ServiceContext } from "../_shared/service-context";
import * as overlay from "../drafts/overlay";
import { inDraftScope, storedForRequest } from "../drafts/service";
import { pages } from "./schema";

// --- Hono routes (multipart upload for the per-page custom OG image) ---
//
// The custom OG image lives only on the page row, NOT in the `files` table —
// so it never surfaces in the media library and can't be reused elsewhere.
// We reuse `/files/serve/:key` to stream the blob back since that handler is
// table-agnostic (it just reads from R2 by key).
//
// Like any content write, setting or clearing it needs a draft: Live is read-only, and the
// create header starts one (ADR 0011). The draft holds its own copy of the page.
//
// Kept in a sibling file to avoid pulling `pages/service.ts` into the import
// graph from `index.ts` — doing so reshuffles esbuild's bundle order and
// trips a TDZ on `createPageInput` (used by ai-tools' `pages` provider).

// Social platforms (Open Graph, Twitter Card) only reliably render these
// formats. SVG/AVIF/BMP/TIFF get dropped or replaced with a placeholder.
const OG_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export const pageHonoRoutes = new Hono<AppEnv>();

/** Deletes an OG image blob once no page row, Live or in any draft, names it. */
const deleteOgBlobIfUnreferenced = Effect.fn("deleteOgBlobIfUnreferenced")(function* (
  db: Database,
  bucket: R2Bucket,
  blobId: string,
) {
  const referenced = yield* Effect.promise(() =>
    db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.customOgImageBlobId, blobId))
      .limit(1)
      .get(),
  );
  if (!referenced) yield* Effect.promise(() => bucket.delete(blobId));
});

/** The page's project as Live or the request's draft stores it, before the draft is checked. */
const projectOfPage = Effect.fn("pages.og.projectOfPage")(function* (
  ctx: ServiceContext,
  pageId: string,
) {
  const page = yield* Effect.promise(() =>
    ctx.db
      .select({ projectId: pages.projectId })
      .from(pages)
      .where(and(eq(pages.id, pageId), storedForRequest(pages, ctx)))
      .get(),
  );
  if (!page) return yield* new NotFoundError();
  return page.projectId;
});

type OgImage = { blobId: string; url: string };

/**
 * Sets (or clears, for `null`) a page's custom OG image in the draft the request names, copying
 * the page into the draft on its first write. The blob the page named before is deleted once no
 * page row names it; a failed write deletes the new blob again.
 */
const writeOgImage = (
  ctx: ServiceContext,
  pageId: string,
  store: (projectId: number) => Effect.Effect<OgImage | null>,
) =>
  Effect.gen(function* () {
    const user = yield* requireUser(ctx);
    const projectId = yield* projectOfPage(ctx, pageId);
    return yield* inDraftScope(ctx, projectId, (scope) =>
      Effect.gen(function* () {
        const access = yield* assertPageAccess(ctx.db, pageId, user.id, scope);
        const prevBlobId = access.page.customOgImageBlobId;
        const image = yield* store(access.page.projectId);
        const dropStored = image
          ? deleteOgBlobIfUnreferenced(ctx.db, ctx.env.FILES_BUCKET, image.blobId)
          : Effect.void;

        const result = yield* overlay
          .update(ctx.db, scope, pages, pageId, {
            customOgImageBlobId: image?.blobId ?? null,
            customOgImageUrl: image?.url ?? null,
            updatedAt: Math.max(Date.now(), access.page.updatedAt + 1),
          })
          .pipe(Effect.onError(() => dropStored));
        if (!result) {
          yield* dropStored;
          return yield* new NotFoundError();
        }

        if (prevBlobId && prevBlobId !== image?.blobId) {
          yield* deleteOgBlobIfUnreferenced(ctx.db, ctx.env.FILES_BUCKET, prevBlobId);
        }

        broadcastInvalidation({
          waitUntil: ctx.waitUntil,
          projectRoomNamespace: ctx.env.ProjectRoom,
          draftId: scope?.id ?? null,
          projectId: access.page.projectId,
          targets: [
            queryKeys.pages.list,
            queryKeys.pages.getById(pageId),
            queryKeys.pages.getByPathAll,
          ],
        });
        return result;
      }),
    );
  });

pageHonoRoutes.post("/:id/og-image", async (c) => {
  const user = c.var.user;
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const pageId = c.req.param("id");
  if (!uuidv7Schema.safeParse(pageId).success) return c.json({ error: "Invalid page id" }, 400);
  const ctx = uploadContextOf(c, user);
  if (ctx instanceof Response) return ctx;

  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "Missing file" }, 400);
  if (!OG_IMAGE_MIME_TYPES.has(file.type)) {
    return c.json({ error: "Image must be JPEG, PNG, GIF, or WebP" }, 400);
  }
  const apiOrigin = new URL(c.req.url).origin;

  const upload = writeOgImage(ctx, pageId, (projectId) =>
    Effect.gen(function* () {
      const key = `${projectId}/page-og/${pageId}-${Date.now()}-${file.name}`;
      yield* Effect.promise(() =>
        c.env.FILES_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } }),
      );
      return { blobId: key, url: `${apiOrigin}/files/serve/${key}` };
    }),
  );
  return respondToUpload(c, upload, 200);
});

pageHonoRoutes.delete("/:id/og-image", async (c) => {
  const user = c.var.user;
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const pageId = c.req.param("id");
  if (!uuidv7Schema.safeParse(pageId).success) return c.json({ error: "Invalid page id" }, 400);
  const ctx = uploadContextOf(c, user);
  if (ctx instanceof Response) return ctx;

  return respondToUpload(
    c,
    writeOgImage(ctx, pageId, () => Effect.succeed(null)),
    200,
  );
});
