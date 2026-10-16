import { DRAFT_CREATE_HEADER, DRAFT_HEADER, DEVELOPMENT_DRAFT } from "@camox/api-contract/drafts";
import { uuidv7Schema } from "@camox/api-contract/ids";
import { ORPCError } from "@orpc/server";
import { Effect } from "effect";
import { Hono, type Handler } from "hono";

import { getAuthorizedProject } from "../../authorization";
import { isRasterImage } from "../../lib/image-transform";
import { runService } from "../../lib/run-service";
import { authed, contentWrite, liveReadOnlyError, pub } from "../../orpc";
import type { AppEnv } from "../../types";
import type { ServiceContext } from "../_shared/service-context";
import { inScope } from "../blocks/draft-scope";
import type { DraftRequest } from "../drafts/scope";
import { inDraftScope } from "../drafts/service";
import * as service from "./service";
import { optimizeVideo } from "./video-optimization";

// Every procedure reads and writes files in the draft the request names (`x-camox-draft`),
// once the file's project is known. Writes need a draft: on Live the create header starts one.

// Public procedures

const list = pub
  .input(service.listFilesInput)
  .handler(({ context, input }) =>
    inScope(context, input.projectId, (scope) => service.listFiles(context, input, scope)),
  );

const get = pub
  .input(service.getFileInput)
  .handler(({ context, input }) =>
    inScope(context, service.projectOfFile(context, input.id), (scope) =>
      service.getFile(context, input, scope),
    ),
  );

const getUsageCount = pub
  .input(service.getFileUsageCountInput)
  .handler(({ context, input }) =>
    inScope(context, service.projectOfFile(context, input.id), (scope) =>
      service.getFileUsageCount(context, input, scope),
    ),
  );

// Protected procedures

const setAlt = contentWrite
  .input(service.setFileAltInput)
  .handler(({ context, input }) =>
    inScope(context, service.projectOfFile(context, input.id), (scope) =>
      service.setFileAlt(context, input, scope),
    ),
  );

const setFilename = contentWrite
  .input(service.setFileFilenameInput)
  .handler(({ context, input }) =>
    inScope(context, service.projectOfFile(context, input.id), (scope) =>
      service.setFileFilename(context, input, scope),
    ),
  );

const deleteFn = contentWrite
  .input(service.deleteFileInput)
  .handler(({ context, input }) =>
    inScope(context, service.projectOfFile(context, input.id), (scope) =>
      service.deleteFile(context, input, scope),
    ),
  );

const deleteMany = contentWrite.input(service.deleteFilesInput).handler(({ context, input }) => {
  const [first] = input.ids;
  const project = first === undefined ? undefined : service.projectOfFile(context, first);
  return inScope(context, project ?? Effect.succeed(undefined), (scope) =>
    service.deleteFiles(context, input, scope),
  );
});

const setAiMetadata = contentWrite
  .input(service.setFileAiMetadataInput)
  .handler(({ context, input }) =>
    inScope(context, service.projectOfFile(context, input.id), (scope) =>
      service.setFileAiMetadata(context, input, scope),
    ),
  );

const generateMetadata = authed
  .input(service.generateFileMetadataInput)
  .handler(({ context, input }) =>
    inScope(context, service.projectOfFile(context, input.id), (scope) =>
      service.generateFileMetadata(context, input, scope),
    ),
  );

export const fileProcedures = {
  list,
  get,
  getUsageCount,
  setAlt,
  setFilename,
  delete: deleteFn,
  deleteMany,
  setAiMetadata,
  generateMetadata,
};

/** The draft an upload names in its headers, like any oRPC request (ADR 0011). */
function draftRequestOf(headers: Headers): DraftRequest | null | "invalid" {
  const id = headers.get(DRAFT_HEADER);
  if (!id) return null;
  if (id === DEVELOPMENT_DRAFT) return { development: true };
  if (!uuidv7Schema.safeParse(id).success) return "invalid";
  return { id, create: headers.get(DRAFT_CREATE_HEADER) === "1" };
}

// --- Hono routes (binary serving + multipart upload) ---

export const fileHonoRoutes = new Hono<AppEnv>();

fileHonoRoutes.on(["GET", "HEAD"], "/serve/*", async (c) => {
  const key = c.req.path.replace(/^\/files\/serve\//, "");
  if (!key) return c.json({ error: "Missing file key" }, 400);

  const metadata = await c.env.FILES_BUCKET.head(key);
  if (!metadata) return c.notFound();

  const headers = new Headers({
    "Content-Type": metadata.httpMetadata?.contentType ?? "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": "inline",
    "Accept-Ranges": "bytes",
  });
  const range = c.req.header("range");
  let offset = 0;
  let length = metadata.size;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      headers.set("Content-Range", `bytes */${metadata.size}`);
      return new Response(null, { status: 416, headers });
    }
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix === 0) {
        headers.set("Content-Range", `bytes */${metadata.size}`);
        return new Response(null, { status: 416, headers });
      }
      offset = Math.max(0, metadata.size - suffix);
    } else {
      offset = Number(match[1]);
      const end = match[2] ? Number(match[2]) : metadata.size - 1;
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(end) ||
        offset > end ||
        offset >= metadata.size
      ) {
        headers.set("Content-Range", `bytes */${metadata.size}`);
        return new Response(null, { status: 416, headers });
      }
      length = Math.min(end, metadata.size - 1) - offset + 1;
    }
    if (!match[1]) length = metadata.size - offset;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${metadata.size}`);
  }
  headers.set("Content-Length", String(length));
  if (c.req.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  const object = await c.env.FILES_BUCKET.get(
    key,
    range ? { range: { offset, length } } : undefined,
  );
  if (!object) return c.notFound();
  return new Response(object.body, { status: range ? 206 : 200, headers });
});

/**
 * Uploads a new file, or replaces a file's content keeping its id (`/:id/content`), in the
 * draft the request names. Like any content write it needs one: Live is read-only, and
 * uploading on Live with the create header starts a draft. The blob
 * is stored before the row is written, and deleted again when the write fails.
 */
const uploadContent: Handler<AppEnv> = async (c) => {
  if (!c.var.user) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id");
  if (id !== undefined && !uuidv7Schema.safeParse(id).success) {
    return c.json({ error: "Invalid file id" }, 400);
  }
  const draft = draftRequestOf(c.req.raw.headers);
  if (draft === "invalid") {
    return c.json({ error: `${DRAFT_HEADER} must be a UUIDv7 or "${DEVELOPMENT_DRAFT}"` }, 400);
  }
  if (!draft) {
    const error = liveReadOnlyError();
    return c.json({ error: error.message, code: error.code }, 409);
  }
  const ctx: ServiceContext = {
    db: c.var.db,
    user: c.var.user,
    env: c.env,
    client: c.var.client ?? "unknown",
    telemetryDisabled: c.var.telemetryDisabled ?? false,
    draft,
    waitUntil: (promise) => c.executionCtx.waitUntil(promise),
  };

  const body = await c.req.parseBody();
  const file = body["file"];
  // Creating accepts a client-minted id for optimistic inserts; replacing names its target.
  const newId = body["id"];
  if (newId !== undefined && (id !== undefined || !uuidv7Schema.safeParse(newId).success)) {
    return c.json({ error: "Invalid file id" }, 400);
  }
  const projectId = Number(body["projectId"]);
  const aiMetadata = body["aiMetadata"];
  if (aiMetadata !== undefined && aiMetadata !== "true" && aiMetadata !== "false") {
    return c.json({ error: "aiMetadata must be true or false" }, 400);
  }
  const metadata = service.fileMetadataInput.safeParse({
    alt: body["alt"],
    aiMetadata: aiMetadata === undefined ? undefined : aiMetadata === "true",
  });
  if (!metadata.success) return c.json({ error: metadata.error.message }, 400);

  if (!(file instanceof File)) return c.json({ error: "Missing file" }, 400);
  if (!Number.isSafeInteger(projectId) || projectId <= 0)
    return c.json({ error: "Missing projectId" }, 400);
  if (file.size > 100 * 1024 * 1024) return c.json({ error: "File exceeds 100 MiB limit" }, 413);
  if (metadata.data.aiMetadata && !isRasterImage(file.type)) {
    return c.json({ error: "Automatic metadata requires a raster image" }, 400);
  }

  const apiOrigin = new URL(c.req.url).origin;
  const filename = file.name.split(/[\\/]/).pop() || "upload";

  const upload = Effect.gen(function* () {
    yield* getAuthorizedProject(ctx.db, projectId, c.var.user!.id);
    return yield* inDraftScope(ctx, projectId, (scope) =>
      Effect.gen(function* () {
        // Reject a missing target before storing any blob.
        if (id !== undefined) yield* service.getProjectFile(ctx, { projectId, id }, scope);

        // Keep storage URLs independent of filenames (spaces, Unicode, URL delimiters).
        const key = `${projectId}/${crypto.randomUUID()}`;
        yield* Effect.promise(() =>
          c.env.FILES_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } }),
        );
        const optimized = yield* optimizeVideo(file, key, c.env.FILES_BUCKET, c.env.MEDIA);
        const asset = {
          blobId: key,
          path: key,
          url: `${apiOrigin}/files/serve/${optimized?.key ?? key}`,
          filename,
          mimeType: file.type,
          size: file.size,
          optimizedSize: optimized?.size ?? null,
        };

        const now = Date.now();
        const write =
          id !== undefined
            ? service.replaceFileContent(ctx, { projectId, id }, asset, metadata.data, scope)
            : service.createFile(
                ctx,
                {
                  ...(typeof newId === "string" ? { id: newId } : {}),
                  ...asset,
                  projectId,
                  createdAt: now,
                  updatedAt: now,
                },
                metadata.data,
                scope,
              );
        // A failed write must not leave an orphaned blob.
        return yield* write.pipe(Effect.onError(() => service.deleteUnreferencedBlobs(ctx, [key])));
      }),
    );
  });

  try {
    const result = await runService(upload);
    return c.json(result, id !== undefined ? 200 : 201);
  } catch (error) {
    if (!(error instanceof ORPCError)) throw error;
    return c.json(
      { error: error.message, code: error.code, data: error.data },
      error.status as 400,
    );
  }
};

fileHonoRoutes.post("/upload", uploadContent);
fileHonoRoutes.post("/:id/content", uploadContent);
