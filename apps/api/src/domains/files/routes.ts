import { queryKeys } from "@camox/api-contract/query-keys";
import { Hono } from "hono";

import { getAuthorizedProject } from "../../authorization";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { isRasterImage } from "../../lib/image-transform";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { scheduleAiJob } from "../../lib/schedule-ai-job";
import { authed, pub } from "../../orpc";
import { files } from "../../schema";
import type { AppEnv } from "../../types";
import * as service from "./service";

// Public procedures

const list = pub
  .input(service.listFilesInput)
  .handler(({ context, input }) => service.listFiles(context, input));

const get = pub
  .input(service.getFileInput)
  .handler(({ context, input }) => service.getFile(context, input));

const getUsageCount = pub
  .input(service.getFileUsageCountInput)
  .handler(({ context, input }) => service.getFileUsageCount(context, input));

// Protected procedures

const setAlt = authed
  .input(service.setFileAltInput)
  .handler(({ context, input }) => service.setFileAlt(context, input));

const setFilename = authed
  .input(service.setFileFilenameInput)
  .handler(({ context, input }) => service.setFileFilename(context, input));

const deleteFn = authed
  .input(service.deleteFileInput)
  .handler(({ context, input }) => service.deleteFile(context, input));

const deleteMany = authed
  .input(service.deleteFilesInput)
  .handler(({ context, input }) => service.deleteFiles(context, input));

const replace = authed
  .input(service.replaceFileInput)
  .handler(({ context, input }) => service.replaceFile(context, input));

const setAiMetadata = authed
  .input(service.setFileAiMetadataInput)
  .handler(({ context, input }) => service.setFileAiMetadata(context, input));

const generateMetadata = authed
  .input(service.generateFileMetadataInput)
  .handler(({ context, input }) => service.generateFileMetadata(context, input));

export const fileProcedures = {
  list,
  get,
  getUsageCount,
  setAlt,
  setFilename,
  delete: deleteFn,
  deleteMany,
  replace,
  setAiMetadata,
  generateMetadata,
};

// --- Hono routes (binary serving + multipart upload) ---

export const fileHonoRoutes = new Hono<AppEnv>();

fileHonoRoutes.get("/serve/*", async (c) => {
  const key = c.req.path.replace(/^\/files\/serve\//, "");
  if (!key) return c.json({ error: "Missing file key" }, 400);

  const object = await c.env.FILES_BUCKET.get(key);
  if (!object) return c.notFound();

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": "inline",
    },
  });
});

fileHonoRoutes.post("/upload", async (c) => {
  if (!c.var.user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.parseBody();
  const file = body["file"];
  const projectId = Number(body["projectId"]);
  const aiMetadata = body["aiMetadataEnabled"];
  if (aiMetadata !== undefined && aiMetadata !== "true" && aiMetadata !== "false") {
    return c.json({ error: "aiMetadataEnabled must be true or false" }, 400);
  }
  const metadata = service.fileMetadataInput.safeParse({
    alt: body["alt"],
    aiMetadataEnabled: aiMetadata === undefined ? undefined : aiMetadata === "true",
  });
  if (!metadata.success) return c.json({ error: metadata.error.message }, 400);

  if (!(file instanceof File)) return c.json({ error: "Missing file" }, 400);
  if (!Number.isSafeInteger(projectId) || projectId <= 0)
    return c.json({ error: "Missing projectId" }, 400);
  if (file.size > 100 * 1024 * 1024) return c.json({ error: "File exceeds 100 MiB limit" }, 413);
  const canGenerateAiMetadata = isRasterImage(file.type);
  if (metadata.data.aiMetadataEnabled && !canGenerateAiMetadata) {
    return c.json({ error: "Automatic metadata requires a raster image" }, 400);
  }
  let aiMetadataEnabled = metadata.data.aiMetadataEnabled ?? null;
  if (metadata.data.alt !== undefined || !canGenerateAiMetadata) aiMetadataEnabled = false;

  const project = await getAuthorizedProject(c.var.db, projectId, c.var.user.id);
  if (!project) return c.json({ error: "Not found" }, 404);

  const environment = await resolveEnvironment(c.var.db, projectId, c.var.environmentName);

  const now = Date.now();
  const filename = file.name.split(/[\\/]/).pop() || "upload";
  // Keep storage URLs independent of filenames (spaces, Unicode, URL delimiters).
  const key = `${projectId}/${crypto.randomUUID()}`;

  await c.env.FILES_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  const apiOrigin = new URL(c.req.url).origin;
  const url = `${apiOrigin}/files/serve/${key}`;

  const result = await c.var.db
    .insert(files)
    .values({
      projectId,
      environmentId: environment.id,
      blobId: key,
      filename,
      mimeType: file.type,
      size: file.size,
      path: key,
      url,
      alt: metadata.data.alt ?? "",
      aiMetadataEnabled,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  if (aiMetadataEnabled !== false) {
    c.executionCtx.waitUntil(
      scheduleAiJob(c.env.AI_JOB_SCHEDULER, {
        entityTable: "files",
        entityId: result.id,
        type: "fileMetadata",
        delayMs: 0,
      }),
    );
  }
  broadcastInvalidation({
    waitUntil: (p) => c.executionCtx.waitUntil(p),
    projectRoomNamespace: c.env.ProjectRoom,
    projectId,
    targets: [queryKeys.files.list, queryKeys.files.get(result.id)],
  });

  return c.json(result, 201);
});
