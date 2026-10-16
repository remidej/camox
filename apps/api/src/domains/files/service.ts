import { uuidv7Schema } from "@camox/api-contract/ids";
import { queryKeys } from "@camox/api-contract/query-keys";
import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { outdent } from "outdent";
import { z } from "zod";

import { getAuthorizedProject, requireUser } from "../../authorization";
import type { Database } from "../../db";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { decodeInput, InvalidInputError, NotFoundError } from "../../lib/errors";
import { isRasterImage, transformImageUrl } from "../../lib/image-transform";
import { files } from "../../schema";
import { referencesTo } from "../_shared/references-to";
import type { ServiceContext } from "../_shared/service-context";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { draftScopeOfJob, storedForRequest } from "../drafts/service";
import { homeOf, requestGeneration, saveValue, settleRequest } from "../generated-values/service";
import {
  fileView,
  metadataColumns,
  metadataGenerated,
  metadataKey,
  type MetadataWrite,
  seedMetadata,
  withFileMetadata,
} from "./generated-metadata";
import { readMetadataImage } from "./metadata-image";
import { optimizedVideoKey } from "./video-optimization";

// Files live in Live and in drafts like any content (ADR 0005): every service takes the draft
// scope it reads and writes, and goes through the draft overlay. A file's bytes are a blob,
// shared by every row naming it and deleted once none does.

type FileRow = typeof files.$inferSelect;

// --- Input Schemas ---
// Exported so adapters (oRPC, MCP, CLI) share the same canonical contract.
// Services .parse() them on entry — service is the trust boundary.

/**
 * A file's alt text and filename are one group, all generated or all manual (ADR 0012): writing
 * either makes it manual, `aiMetadata: true` makes it generated again.
 */
export const fileMetadataInput = z
  .object({ alt: z.string().optional(), aiMetadata: z.boolean().optional() })
  .refine((data) => data.alt === undefined || data.aiMetadata !== true, {
    message: "Alt text cannot be combined with automatic metadata enabled.",
  });
export const projectFileInput = z.object({ projectId: z.number(), id: uuidv7Schema });
export const updateFileMetadataInput = fileMetadataInput
  .and(
    z.object({
      filename: z
        .string()
        .refine(
          (filename) =>
            filename.trim().length > 0 &&
            filename !== "." &&
            filename !== ".." &&
            !/[\\/]/.test(filename) &&
            !filename
              .split("")
              .some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127),
          { message: "Provide a non-empty filename without directories or control characters." },
        )
        .optional(),
    }),
  )
  .refine((data) => data.aiMetadata !== true || data.filename === undefined, {
    message: "A filename cannot be combined with automatic metadata enabled.",
  })
  .refine(
    (data) =>
      data.alt !== undefined || data.aiMetadata !== undefined || data.filename !== undefined,
    {
      message: "Provide a filename, alt text or an automatic metadata setting.",
    },
  );
export const updateFileInput = projectFileInput.and(updateFileMetadataInput);

export const listFilesInput = z.object({ projectId: z.number() });
export const getFileInput = z.object({ id: uuidv7Schema });
export const getFileUsageCountInput = z.object({ id: uuidv7Schema });
export const setFileAltInput = z.object({ id: uuidv7Schema, alt: z.string() });
export const setFileFilenameInput = z.object({ id: uuidv7Schema, filename: z.string() });
export const deleteFileInput = z.object({ id: uuidv7Schema });
export const deleteFilesInput = z.object({ ids: z.array(uuidv7Schema) });
export const setFileAiMetadataInput = z.object({ id: uuidv7Schema, enabled: z.boolean() });
export const generateFileMetadataInput = z.object({ id: uuidv7Schema });

const generateImageMetadata = Effect.fn("generateImageMetadata")(function* (
  apiKey: string,
  imageUrl: string,
  imageMimeType: string,
  currentFilename: string,
  abortController?: AbortController,
) {
  // Gemini 2.5 Flash Lite processes images in 768×768 tiles — larger sizes are
  // downsampled by the model and just inflate tokens. Bound BOTH dimensions so
  // very tall or very wide images fit inside one tile instead of being split.
  // Force WebP so the payload is small and the format is accepted across vision
  // models (AVIF support is inconsistent). SVG passes through unchanged.
  const optimizedUrl = transformImageUrl(imageUrl, {
    width: 768,
    height: 768,
    format: "webp",
    mimeType: imageMimeType,
  });
  // Fetch image server-side — the AI provider can't reach localhost URLs in development
  const response = yield* Effect.promise(() =>
    fetch(optimizedUrl, { signal: abortController?.signal }),
  );
  const { bytes, mimeType } = yield* readMetadataImage(response);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  return yield* Effect.promise(() =>
    chat({
      adapter: createOpenRouterText("google/gemini-2.5-flash-lite", apiKey),
      abortController,
      outputSchema: z.object({
        filename: z.string(),
        alt: z.string(),
      }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image" as const,
              source: { type: "data" as const, value: base64, mimeType },
            },
            {
              type: "text" as const,
              content: outdent`
              Analyze this image and generate metadata for it:
              - "filename": a clean, descriptive filename in kebab-case (no extension). The current filename is "${currentFilename}". If it's already human-readable and descriptive, keep it as-is (without the extension). Only rewrite it if it's gibberish, a random hash, or not meaningful (e.g. "IMG_2847", "DSC0042", "a7f3b2c9").
              - "alt": SEO-optimized alt text describing the image content. Be concise but descriptive (1 sentence max).
            `,
            },
          ],
        },
      ],
    }),
  );
});

function invalidateFile(
  ctx: ServiceContext,
  projectId: number,
  scope: DraftScope,
  targets: Parameters<typeof broadcastInvalidation>[0]["targets"],
) {
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: scope?.id ?? null,
    projectId,
    targets,
  });
}

/** Requests the file's metadata in the scope it was asked from (ADR 0012). */
const requestFileMetadata = (
  ctx: ServiceContext,
  file: { id: string; projectId: number | null },
  scope: DraftScope,
) =>
  requestGeneration(ctx, homeOf(scope, file.projectId!), {
    entity: "file",
    entityId: file.id,
    delayMs: 0,
  });

// --- AI Executor ---

/**
 * Generates a file's metadata as the scope reads it, into the scope's generated values: never
 * into the file, so it never copies one into a draft (ADR 0012). Files whose metadata is manual
 * are skipped.
 */
export const executeFileMetadata = Effect.fn("files.executeFileMetadata")(function* (
  db: Database,
  apiKey: string,
  fileId: string,
  scope: DraftScope,
  abortController?: AbortController,
) {
  const startedAt = Date.now();
  const file = yield* overlay.get(db, scope, files, fileId);
  if (!file?.projectId) return;
  const home = homeOf(scope, file.projectId);
  if (!metadataGenerated(file) || !isRasterImage(file.mimeType)) {
    yield* settleRequest(db, home, metadataKey(fileId), startedAt);
    return;
  }
  const shown = yield* fileView(db, scope, file);

  // An unusable image fails the attempt like any other AI job error, so the
  // scheduler can retry it.
  const metadata = yield* generateImageMetadata(
    apiKey,
    file.url,
    file.mimeType,
    shown.filename,
    abortController,
  ).pipe(Effect.orDie);
  yield* saveValue(
    db,
    home,
    metadataKey(fileId),
    { alt: metadata.alt, filename: metadata.filename },
    startedAt,
  );
});

/**
 * Runs a scheduled metadata job in the scope it was scheduled from. Returns the file's project
 * to refresh, or undefined when the draft has ended or the file is gone.
 */
export const runFileMetadataJob = Effect.fn("files.runFileMetadataJob")(function* (
  db: Database,
  apiKey: string,
  job: { entityId: string; draftId: string | null },
  abortController?: AbortController,
) {
  const scope = yield* draftScopeOfJob(db, job.draftId);
  if (scope === undefined) return undefined;
  yield* executeFileMetadata(db, apiKey, job.entityId, scope, abortController);
  const file = yield* overlay.get(db, scope, files, job.entityId);
  return file?.projectId ?? undefined;
});

// --- Blobs ---

/**
 * Deletes the blobs among `blobIds` that no file row names any more, in Live or any draft,
 * tombstones included. Called after anything that drops or repoints rows: a publish, a
 * discard, a replace, a delete, a failed upload. There is no scheduled cleanup.
 */
export const deleteUnreferencedBlobs = Effect.fn("files.deleteUnreferencedBlobs")(function* (
  ctx: Pick<ServiceContext, "db" | "env">,
  blobIds: Iterable<string>,
) {
  const candidates = [...new Set(blobIds)];
  if (candidates.length === 0) return;
  const named = yield* Effect.promise(() =>
    ctx.db
      .selectDistinct({ blobId: files.blobId })
      .from(files)
      .where(inArray(files.blobId, candidates)),
  );
  const kept = new Set(named.map((row) => row.blobId));
  yield* Effect.forEach(
    candidates.filter((blobId) => !kept.has(blobId)),
    (blobId) => deleteFileBlob(ctx, blobId),
    { concurrency: "unbounded", discard: true },
  );
});

export const deleteUnreferencedFileBlob = (
  ctx: Pick<ServiceContext, "db" | "env">,
  blobId: string,
) => deleteUnreferencedBlobs(ctx, [blobId]);

const deleteFileBlob = Effect.fn("deleteFileBlob")(function* (
  ctx: Pick<ServiceContext, "env">,
  blobId: string,
) {
  yield* Effect.promise(() =>
    Promise.all([
      ctx.env.FILES_BUCKET.delete(blobId),
      ctx.env.FILES_BUCKET.delete(optimizedVideoKey(blobId)),
    ]),
  );
});

/**
 * The blobs a draft's rows name, and those of the Live rows it copies or deletes: what may lose
 * its last reference when the draft is published or discarded. Collect them before the batch,
 * which drops the draft's rows.
 */
export const blobsOfDraft = Effect.fn("files.blobsOfDraft")(function* (
  db: Database,
  scope: NonNullable<DraftScope>,
) {
  const stored = yield* Effect.promise(() =>
    db
      .select({ id: files.id, blobId: files.blobId })
      .from(files)
      .where(overlay.storedIn(files, scope)),
  );
  const ids = stored.map((row) => row.id);
  const live = ids.length ? yield* overlay.select(db, null, files, inArray(files.id, ids)) : [];
  return [...new Set([...stored, ...live].map((row) => row.blobId))];
});

// --- Reads ---

/**
 * The project of a file, from its Live row or the named draft's, so a request naming a draft
 * finds a file the draft uploaded. Undefined without a draft: the request reads Live.
 */
export const projectOfFile = Effect.fn("files.projectOfFile")(function* (
  ctx: Pick<ServiceContext, "db" | "draft" | "user">,
  fileId: string,
) {
  if (!ctx.draft) return undefined;
  const row = yield* Effect.promise(() =>
    ctx.db
      .select({ projectId: files.projectId })
      .from(files)
      .where(and(eq(files.id, fileId), storedForRequest(files, ctx)))
      .get(),
  );
  return row?.projectId ?? undefined;
});

/** The file as the scope reads it, for a member of its project. */
const authorizedFile = Effect.fn("files.authorizedFile")(function* (
  ctx: ServiceContext,
  id: string,
  scope: DraftScope,
) {
  const user = yield* requireUser(ctx);
  const file = yield* overlay.get(ctx.db, scope, files, id);
  if (!file?.projectId) return yield* new NotFoundError();
  yield* getAuthorizedProject(ctx.db, file.projectId, user.id);
  return file as FileRow & { projectId: number };
});

export const listFiles = Effect.fn("files.listFiles")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listFilesInput>,
  scope: DraftScope,
) {
  const { projectId } = yield* decodeInput(listFilesInput, rawInput);
  const rows = yield* overlay.select(ctx.db, scope, files, eq(files.projectId, projectId));
  return yield* withFileMetadata(ctx.db, scope, rows);
});

export const getFile = Effect.fn("files.getFile")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getFileInput>,
  scope: DraftScope,
) {
  const { id } = yield* decodeInput(getFileInput, rawInput);
  const result = yield* overlay.get(ctx.db, scope, files, id);
  if (!result) return yield* new NotFoundError();
  return yield* fileView(ctx.db, scope, result);
});

/** How many pieces of content use the file, as the scope sees them. */
export const getFileUsageCount = Effect.fn("files.getFileUsageCount")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getFileUsageCountInput>,
  scope: DraftScope,
) {
  const { id } = yield* decodeInput(getFileUsageCountInput, rawInput);
  const file = yield* overlay.get(ctx.db, scope, files, id);
  if (!file) return yield* new NotFoundError();

  const uses = yield* referencesTo(
    ctx.db,
    { projectId: file.projectId, draft: scope },
    { kind: "file", id: file.id },
  );
  return { count: uses.length };
});

// Authenticated, project-scoped access for agent tools.
export const getProjectFile = Effect.fn("files.getProjectFile")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof projectFileInput>,
  scope: DraftScope,
) {
  const user = yield* requireUser(ctx);
  const { projectId, id } = yield* decodeInput(projectFileInput, rawInput);
  yield* getAuthorizedProject(ctx.db, projectId, user.id);
  const file = yield* overlay.get(ctx.db, scope, files, id);
  if (!file || file.projectId !== projectId) {
    return yield* new NotFoundError();
  }
  return yield* fileView(ctx.db, scope, file);
});

// --- Writes ---

/** Changes a file as the scope reads it: in a draft, the first change copies it there. */
const writeFile = Effect.fn("files.writeFile")(function* (
  ctx: ServiceContext,
  scope: DraftScope,
  file: FileRow,
  patch: Partial<FileRow>,
) {
  const { id: _id, rowId: _rowId, ...values } = patch;
  const result = yield* overlay.update(ctx.db, scope, files, file.id, {
    ...values,
    updatedAt: Math.max(Date.now(), file.updatedAt + 1),
  });
  if (!result) return yield* new NotFoundError();
  invalidateFile(ctx, file.projectId!, scope, [queryKeys.files.list, queryKeys.files.get(file.id)]);
  return result;
});

/**
 * Writes a file's metadata group (ADR 0012): any field makes it manual, copying the generated
 * values into the fields not written; `aiMetadata: true` makes it generated again and requests
 * generation, starting from the metadata shown so far.
 */
const writeMetadata = Effect.fn("files.writeMetadata")(function* (
  ctx: ServiceContext,
  scope: DraftScope,
  file: FileRow,
  write: MetadataWrite,
) {
  if (write.aiMetadata && !isRasterImage(file.mimeType)) {
    return yield* new InvalidInputError({ message: "Automatic metadata requires a raster image." });
  }
  const shown = yield* fileView(ctx.db, scope, file);
  const { columns, generate } = yield* metadataColumns(ctx.db, scope, file, write);
  const result = yield* writeFile(ctx, scope, file, columns);
  if (generate) {
    const home = homeOf(scope, file.projectId!);
    yield* seedMetadata(ctx.db, scope, home, file.id, { alt: shown.alt, filename: shown.filename });
    yield* requestFileMetadata(ctx, file, scope);
  }
  return yield* fileView(ctx.db, scope, result);
});

export const updateFile = Effect.fn("files.updateFile")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof updateFileInput>,
  scope: DraftScope,
) {
  const input = yield* decodeInput(updateFileInput, rawInput);
  const file = yield* getProjectFile(ctx, input, scope);
  const stored = yield* overlay.get(ctx.db, scope, files, file.id);
  if (!stored) return yield* new NotFoundError();
  return yield* writeMetadata(ctx, scope, stored, input);
});

export const setFileAlt = Effect.fn("files.setFileAlt")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setFileAltInput>,
  scope: DraftScope,
) {
  const { id, alt } = yield* decodeInput(setFileAltInput, rawInput);
  const file = yield* authorizedFile(ctx, id, scope);
  return yield* writeMetadata(ctx, scope, file, { alt });
});

export const setFileFilename = Effect.fn("files.setFileFilename")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setFileFilenameInput>,
  scope: DraftScope,
) {
  const { id, filename } = yield* decodeInput(setFileFilenameInput, rawInput);
  const file = yield* authorizedFile(ctx, id, scope);
  return yield* writeMetadata(ctx, scope, file, { filename });
});

/**
 * Deletes files as the scope reads them. Content that uses them is left alone: publishing a
 * draft that deletes a file still in use is blocked until the content is fixed (ADR 0009).
 */
const removeFiles = Effect.fn("files.removeFiles")(function* (
  ctx: ServiceContext,
  scope: DraftScope,
  shown: FileRow[],
) {
  for (const file of shown) yield* overlay.remove(ctx.db, scope, files, file.id);
  // A draft's tombstone still names the blob Live serves; a deleted row names nothing.
  yield* deleteUnreferencedBlobs(
    ctx,
    shown.map((file) => file.blobId),
  );
  invalidateFile(ctx, shown[0]!.projectId!, scope, [
    queryKeys.files.list,
    ...shown.map((file) => queryKeys.files.get(file.id)),
    queryKeys.blocks.getUsageCounts,
  ]);
});

export const deleteFile = Effect.fn("files.deleteFile")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteFileInput>,
  scope: DraftScope,
) {
  const { id } = yield* decodeInput(deleteFileInput, rawInput);
  const file = yield* authorizedFile(ctx, id, scope);
  yield* removeFiles(ctx, scope, [file]);
  return file;
});

export const deleteFiles = Effect.fn("files.deleteFiles")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteFilesInput>,
  scope: DraftScope,
) {
  const { ids } = yield* decodeInput(deleteFilesInput, rawInput);
  if (ids.length === 0) return [];
  const shown: FileRow[] = [];
  for (const id of new Set(ids)) shown.push(yield* authorizedFile(ctx, id, scope));
  yield* removeFiles(ctx, scope, shown);
  return ids;
});

type FileAsset = Pick<
  FileRow,
  "blobId" | "path" | "url" | "mimeType" | "size" | "optimizedSize"
> & {
  /** The uploaded file's name. */
  filename: string;
};

/**
 * Replaces a file's bytes and explicit metadata in one write, keeping its id, so everything
 * using it shows the new bytes. In a draft the file is copied with the new blob, and Live keeps
 * serving the old one until the draft is published. The blob the scope showed before is
 * deleted once nothing names it. Generated metadata starts from the new upload's name until a
 * job generates it again; manual metadata takes the new name.
 */
export const replaceFileContent = Effect.fn("files.replaceFileContent")(function* (
  ctx: ServiceContext,
  target: z.input<typeof projectFileInput>,
  asset: FileAsset,
  rawMetadata: z.input<typeof fileMetadataInput>,
  scope: DraftScope,
) {
  const metadata = yield* decodeInput(fileMetadataInput, rawMetadata);
  const oldFile = yield* getProjectFile(ctx, target, scope);
  const raster = isRasterImage(asset.mimeType);
  if (metadata.aiMetadata && !raster) {
    return yield* new InvalidInputError({ message: "Automatic metadata requires a raster image." });
  }
  const generated =
    raster && metadata.alt === undefined && (metadata.aiMetadata ?? oldFile.aiMetadata);
  const columns = generated
    ? { alt: null, filename: null }
    : { alt: metadata.alt ?? oldFile.alt, filename: asset.filename };
  const result = yield* overlay.update(ctx.db, scope, files, oldFile.id, {
    blobId: asset.blobId,
    path: asset.path,
    url: asset.url,
    mimeType: asset.mimeType,
    size: asset.size,
    optimizedSize: asset.optimizedSize,
    ...columns,
    updatedAt: Math.max(Date.now(), oldFile.updatedAt + 1),
  });
  if (!result) return yield* new NotFoundError();

  yield* deleteUnreferencedBlobs(ctx, [oldFile.blobId]);
  if (generated) {
    const home = homeOf(scope, target.projectId);
    yield* saveValue(
      ctx.db,
      home,
      metadataKey(oldFile.id),
      {
        alt: oldFile.alt,
        filename: asset.filename,
      },
      0,
    );
    yield* requestFileMetadata(ctx, result, scope);
  }
  invalidateFile(ctx, target.projectId, scope, [
    queryKeys.files.list,
    queryKeys.files.get(oldFile.id),
    queryKeys.blocks.getUsageCounts,
    queryKeys.pages.getByPathAll,
  ]);
  return yield* fileView(ctx.db, scope, result);
});

/**
 * Adds an uploaded file to the scope: a draft's upload stays out of Live until published. A
 * raster image's metadata is generated unless it's given or switched off, starting from the
 * upload's name.
 */
export const createFile = Effect.fn("files.createFile")(function* (
  ctx: ServiceContext,
  values: Omit<typeof files.$inferInsert, "rowId" | "draftId" | "alt" | "filename"> & {
    projectId: number;
    filename: string;
  },
  metadata: z.input<typeof fileMetadataInput>,
  scope: DraftScope,
) {
  const { alt, aiMetadata } = yield* decodeInput(fileMetadataInput, metadata);
  const raster = isRasterImage(values.mimeType);
  if (aiMetadata && !raster) {
    return yield* new InvalidInputError({ message: "Automatic metadata requires a raster image." });
  }
  const generated = raster && alt === undefined && aiMetadata !== false;
  const created = yield* overlay.insert(ctx.db, scope, files, {
    ...values,
    ...(generated ? { alt: null, filename: null } : { alt: alt ?? "", filename: values.filename }),
  });
  if (!created) {
    return yield* new InvalidInputError({ message: "A file with this id already exists" });
  }
  if (generated) {
    const home = homeOf(scope, values.projectId);
    yield* saveValue(
      ctx.db,
      home,
      metadataKey(created.id),
      {
        alt: "",
        filename: values.filename,
      },
      0,
    );
    yield* requestFileMetadata(ctx, created, scope);
  }
  invalidateFile(ctx, values.projectId, scope, [
    queryKeys.files.list,
    queryKeys.files.get(created.id),
  ]);
  return yield* fileView(ctx.db, scope, created);
});

export const setFileAiMetadata = Effect.fn("files.setFileAiMetadata")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setFileAiMetadataInput>,
  scope: DraftScope,
) {
  const { id, enabled } = yield* decodeInput(setFileAiMetadataInput, rawInput);
  const file = yield* authorizedFile(ctx, id, scope);
  return yield* writeMetadata(ctx, scope, file, { aiMetadata: enabled });
});

/** Generates a file's metadata now, into the scope's generated values. */
export const generateFileMetadata = Effect.fn("files.generateFileMetadata")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof generateFileMetadataInput>,
  scope: DraftScope,
) {
  const { id } = yield* decodeInput(generateFileMetadataInput, rawInput);
  const file = yield* authorizedFile(ctx, id, scope);

  yield* executeFileMetadata(ctx.db, ctx.env.OPEN_ROUTER_API_KEY, id, scope);
  invalidateFile(ctx, file.projectId, scope, [queryKeys.files.list, queryKeys.files.get(id)]);
  const shown = yield* overlay.get(ctx.db, scope, files, id);
  return shown ? yield* fileView(ctx.db, scope, shown) : undefined;
});
