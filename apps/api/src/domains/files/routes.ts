import { uuidv7Schema } from "@camox/api-contract/ids";
import { Hono, type Handler } from "hono";

import { edgeCacheTags } from "../../lib/edge-cache-purges";
import { isRasterImage } from "../../lib/image-transform";
import { runService } from "../../lib/run-service";
import { respondToUpload, uploadContextOf } from "../../lib/upload-request";
import { authed, contentWrite, pub } from "../../orpc";
import type { AppEnv } from "../../types";
import * as service from "./service";
import { MAX_UPLOAD_BYTES, storeUpload } from "./upload";

// Every procedure reads and writes files in the draft the request names (`x-camox-draft`),
// once the file's project is known. Writes need a draft: on Live the create header starts one.

// Public procedures

const list = pub
  .input(service.listFilesInput)
  .handler(({ context, input }) => runService(service.listFiles(context, input)));

const get = pub
  .input(service.getFileInput)
  .handler(({ context, input }) => runService(service.getFile(context, input)));

const getUsageCount = pub
  .input(service.getFileUsageCountInput)
  .handler(({ context, input }) => runService(service.getFileUsageCount(context, input)));

// Protected procedures

const setAlt = contentWrite
  .input(service.setFileAltInput)
  .handler(({ context, input }) => runService(service.setFileAlt(context, input)));

const setFilename = contentWrite
  .input(service.setFileFilenameInput)
  .handler(({ context, input }) => runService(service.setFileFilename(context, input)));

const deleteFn = contentWrite
  .input(service.deleteFileInput)
  .handler(({ context, input }) => runService(service.deleteFile(context, input)));

const deleteMany = contentWrite
  .input(service.deleteFilesInput)
  .handler(({ context, input }) => runService(service.deleteFiles(context, input)));

const setAiMetadata = contentWrite
  .input(service.setFileAiMetadataInput)
  .handler(({ context, input }) => runService(service.setFileAiMetadata(context, input)));

const generateMetadata = authed
  .input(service.generateFileMetadataInput)
  .handler(({ context, input }) => runService(service.generateFileMetadata(context, input)));

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

// --- Hono routes (binary serving + multipart upload) ---

export const fileHonoRoutes = new Hono<AppEnv>();

// A stored file's key never names other bytes: replacing a file's content stores it under a new
// key. So the edge keeps a file for good, and purges it only once its blob is deleted
// (`deleteUnreferencedBlobs`). In production the edge answers Range and HEAD requests from the
// full file it stored, so they only reach this route where the edge caches nothing, as in dev.
fileHonoRoutes.on(["GET", "HEAD"], "/serve/*", async (c) => {
  const key = c.req.path.replace(/^\/files\/serve\//, "");
  if (!key) return c.json({ error: "Missing file key" }, 400);

  const metadata = await c.env.FILES_BUCKET.head(key);
  if (!metadata) return c.notFound();

  const headers = new Headers({
    "Content-Type": metadata.httpMetadata?.contentType ?? "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Cache-Tag": edgeCacheTags.file(key),
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
 * uploading on Live with the create header starts a draft.
 */
const uploadContent: Handler<AppEnv> = async (c) => {
  if (!c.var.user) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id");
  if (id !== undefined && !uuidv7Schema.safeParse(id).success) {
    return c.json({ error: "Invalid file id" }, 400);
  }
  const ctx = uploadContextOf(c, c.var.user);
  if (ctx instanceof Response) return ctx;

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
  if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: "File exceeds 100 MiB limit" }, 413);
  if (metadata.data.aiMetadata && !isRasterImage(file.type)) {
    return c.json({ error: "Automatic metadata requires a raster image" }, 400);
  }

  const upload = storeUpload(ctx, {
    projectId,
    file,
    metadata: metadata.data,
    apiOrigin: new URL(c.req.url).origin,
    targetId: id,
    newId: typeof newId === "string" ? newId : undefined,
  });

  return respondToUpload(c, upload, id !== undefined ? 200 : 201);
};

fileHonoRoutes.post("/upload", uploadContent);
fileHonoRoutes.post("/:id/content", uploadContent);
