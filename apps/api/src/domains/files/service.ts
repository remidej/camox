import { queryKeys } from "@camox/api-contract/query-keys";
import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { and, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { outdent } from "outdent";
import { z } from "zod";

import { assertFileAccess, getAuthorizedProject, requireUser } from "../../authorization";
import type { Database } from "../../db";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { decodeInput, ForbiddenError, InvalidInputError, NotFoundError } from "../../lib/errors";
import { isRasterImage, transformImageUrl } from "../../lib/image-transform";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { scheduleAiJob } from "../../lib/schedule-ai-job";
import { blocks, files, layouts, member, pages, projects, repeatableItems } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { assertNoCollectionAssetUse } from "../collections/asset-retention";
import { readMetadataImage } from "./metadata-image";
import { optimizedVideoKey } from "./video-optimization";

// --- Input Schemas ---
// Exported so adapters (oRPC, MCP, CLI) share the same canonical contract.
// Services .parse() them on entry — service is the trust boundary.

export const fileMetadataInput = z
  .object({ alt: z.string().optional(), aiMetadataEnabled: z.boolean().optional() })
  .refine((data) => data.alt === undefined || data.aiMetadataEnabled !== true, {
    message: "Alt text cannot be combined with automatic metadata enabled.",
  });
export const projectFileInput = z.object({ projectId: z.number(), id: z.number() });
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
  .refine(
    (data) =>
      data.alt !== undefined || data.aiMetadataEnabled !== undefined || data.filename !== undefined,
    {
      message: "Provide a filename, alt text or an automatic metadata setting.",
    },
  );
export const updateFileInput = projectFileInput.and(updateFileMetadataInput);

export const listFilesInput = z.object({ projectId: z.number() });
export const getFileInput = z.object({ id: z.number() });
export const getFileUsageCountInput = z.object({ id: z.number() });
export const setFileAltInput = z.object({ id: z.number(), alt: z.string() });
export const setFileFilenameInput = z.object({ id: z.number(), filename: z.string() });
export const deleteFileInput = z.object({ id: z.number() });
export const deleteFilesInput = z.object({ ids: z.array(z.number()) });
export const replaceFileInput = z.object({ id: z.number(), newFileId: z.number() });
export const setFileAiMetadataInput = z.object({ id: z.number(), enabled: z.boolean() });
export const generateFileMetadataInput = z.object({ id: z.number() });

function invalidateFile(
  ctx: ServiceContext,
  projectId: number,
  targets: Parameters<typeof broadcastInvalidation>[0]["targets"],
) {
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId,
    targets,
  });
}

// --- AI Executor ---

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

export const executeFileMetadata = Effect.fn("files.executeFileMetadata")(function* (
  db: Database,
  apiKey: string,
  fileId: number,
  abortController?: AbortController,
) {
  const file = yield* Effect.promise(() =>
    db.select().from(files).where(eq(files.id, fileId)).get(),
  );
  if (!file || file.aiMetadataEnabled === false) return;
  if (!isRasterImage(file.mimeType)) return;

  // An unusable image fails the attempt like any other AI job error, so the
  // scheduler can retry it.
  const metadata = yield* generateImageMetadata(
    apiKey,
    file.url,
    file.mimeType,
    file.filename,
    abortController,
  ).pipe(Effect.orDie);
  yield* saveGeneratedFileMetadata(db, file, metadata);
});

export const saveGeneratedFileMetadata = Effect.fn("files.saveGeneratedFileMetadata")(function* (
  db: Database,
  file: Pick<typeof files.$inferSelect, "id" | "updatedAt">,
  metadata: { filename: string; alt: string },
) {
  yield* Effect.promise(() =>
    db
      .update(files)
      .set({
        filename: metadata.filename,
        alt: metadata.alt,
        updatedAt: Math.max(Date.now(), file.updatedAt + 1),
      })
      // Do not overwrite manual edits or a replaced asset while generation was in flight.
      .where(
        and(
          eq(files.id, file.id),
          eq(files.updatedAt, file.updatedAt),
          sql`${files.aiMetadataEnabled} IS NOT 0`,
        ),
      ),
  );
});

// --- File reference cleanup ---

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function cleanFileReferences(value: JsonValue, fileId: number): JsonValue {
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value
      .filter((entry) => !containsFileRef(entry, fileId))
      .map((entry) => cleanFileReferences(entry, fileId) as JsonValue);
  }

  // Object with _fileId — direct file reference
  if ("_fileId" in value && value._fileId === fileId) return null;

  // Recurse into object properties
  const cleaned: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(value)) {
    cleaned[k] = cleanFileReferences(v as JsonValue, fileId);
  }
  return cleaned;
}

function containsFileRef(value: JsonValue, fileId: number): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => containsFileRef(v, fileId));
  if ("_fileId" in value && value._fileId === fileId) return true;
  return Object.values(value).some((v) => containsFileRef(v as JsonValue, fileId));
}

export const removeFileReferences = Effect.fn("files.removeFileReferences")(function* (
  db: Database,
  fileId: number,
) {
  const marker = `"_fileId":${fileId}`;
  const now = Date.now();

  const affectedBlocks = yield* Effect.promise(() =>
    db
      .select({ id: blocks.id, content: blocks.content, pageId: blocks.pageId })
      .from(blocks)
      .where(sql`INSTR(${blocks.content}, ${marker}) > 0`),
  );

  const affectedItems = yield* Effect.promise(() =>
    db
      .select({
        id: repeatableItems.id,
        content: repeatableItems.content,
        blockId: repeatableItems.blockId,
      })
      .from(repeatableItems)
      .where(sql`INSTR(${repeatableItems.content}, ${marker}) > 0`),
  );

  for (const block of affectedBlocks) {
    const cleaned = cleanFileReferences(block.content as JsonValue, fileId);
    yield* Effect.promise(() =>
      db.update(blocks).set({ content: cleaned, updatedAt: now }).where(eq(blocks.id, block.id)),
    );
  }

  for (const item of affectedItems) {
    const cleaned = cleanFileReferences(item.content as JsonValue, fileId);
    yield* Effect.promise(() =>
      db
        .update(repeatableItems)
        .set({ content: cleaned, updatedAt: now })
        .where(eq(repeatableItems.id, item.id)),
    );
  }

  const itemBlockIds = affectedItems.map((i) => i.blockId);
  const allBlockIds = [...new Set([...affectedBlocks.map((b) => b.id), ...itemBlockIds])];

  // Look up pageIds for blocks referenced by affected repeatable items
  let itemBlockPageIds: number[] = [];
  if (itemBlockIds.length > 0) {
    const uniqueItemBlockIds = [...new Set(itemBlockIds)];
    const parentBlocks = yield* Effect.promise(() =>
      db
        .select({ id: blocks.id, pageId: blocks.pageId })
        .from(blocks)
        .where(inArray(blocks.id, uniqueItemBlockIds)),
    );
    itemBlockPageIds = parentBlocks.map((b) => b.pageId).filter((id) => id != null);
  }

  const allPageIds = [
    ...new Set([
      ...affectedBlocks.map((b) => b.pageId).filter((id) => id != null),
      ...itemBlockPageIds,
    ]),
  ];

  return {
    blockIds: allBlockIds,
    blockPageIds: allPageIds,
    itemIds: affectedItems.map((i) => i.id),
  };
});

// --- Reads ---

export const listFiles = Effect.fn("files.listFiles")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listFilesInput>,
) {
  const { projectId } = yield* decodeInput(listFilesInput, rawInput);
  const environment = yield* resolveEnvironment(ctx.db, projectId, ctx.environmentName);
  return yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(files)
      .where(and(eq(files.projectId, projectId), eq(files.environmentId, environment.id))),
  );
});

export const getFile = Effect.fn("files.getFile")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getFileInput>,
) {
  const { id } = yield* decodeInput(getFileInput, rawInput);
  const result = yield* Effect.promise(() =>
    ctx.db.select().from(files).where(eq(files.id, id)).get(),
  );
  if (!result) return yield* new NotFoundError();
  return result;
});

export const getFileUsageCount = Effect.fn("files.getFileUsageCount")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getFileUsageCountInput>,
) {
  const { id } = yield* decodeInput(getFileUsageCountInput, rawInput);
  const file = yield* Effect.promise(() =>
    ctx.db.select().from(files).where(eq(files.id, id)).get(),
  );
  if (!file) return yield* new NotFoundError();

  const marker = `"_fileId":${file.id}`;
  const blockCount = yield* Effect.promise(() =>
    ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(blocks)
      .where(sql`INSTR(${blocks.content}, ${marker}) > 0`)
      .get(),
  );
  const itemCount = yield* Effect.promise(() =>
    ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(repeatableItems)
      .where(sql`INSTR(${repeatableItems.content}, ${marker}) > 0`)
      .get(),
  );
  return { count: (blockCount?.count ?? 0) + (itemCount?.count ?? 0) };
});

// Authenticated, project/environment-scoped access for agent tools.
export const getProjectFile = Effect.fn("files.getProjectFile")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof projectFileInput>,
) {
  const user = yield* requireUser(ctx);
  const { projectId, id } = yield* decodeInput(projectFileInput, rawInput);
  yield* getAuthorizedProject(ctx.db, projectId, user.id);
  const environment = yield* resolveEnvironment(ctx.db, projectId, ctx.environmentName);
  const file = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, id),
          eq(files.projectId, projectId),
          eq(files.environmentId, environment.id),
        ),
      )
      .get(),
  );
  if (!file) return yield* new NotFoundError();
  return file;
});

// --- Writes ---

export const updateFile = Effect.fn("files.updateFile")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof updateFileInput>,
) {
  const input = yield* decodeInput(updateFileInput, rawInput);
  const file = yield* getProjectFile(ctx, input);
  if (input.aiMetadataEnabled && !isRasterImage(file.mimeType)) {
    return yield* new InvalidInputError({ message: "Automatic metadata requires a raster image." });
  }
  const aiMetadataEnabled = input.alt !== undefined ? false : input.aiMetadataEnabled;
  const result = yield* Effect.promise(() =>
    ctx.db
      .update(files)
      .set({
        ...(input.alt !== undefined ? { alt: input.alt } : {}),
        ...(input.filename !== undefined ? { filename: input.filename } : {}),
        ...(aiMetadataEnabled !== undefined ? { aiMetadataEnabled } : {}),
        updatedAt: Math.max(Date.now(), file.updatedAt + 1),
      })
      .where(eq(files.id, file.id))
      .returning()
      .get(),
  );
  if (aiMetadataEnabled) {
    ctx.waitUntil(
      scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
        entityTable: "files",
        entityId: file.id,
        type: "fileMetadata",
        delayMs: 0,
      }),
    );
  }
  invalidateFile(ctx, input.projectId, [queryKeys.files.list, queryKeys.files.get(file.id)]);
  return result;
});

export const setFileAlt = Effect.fn("files.setFileAlt")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setFileAltInput>,
) {
  const user = yield* requireUser(ctx);
  const { id, alt } = yield* decodeInput(setFileAltInput, rawInput);
  const access = yield* assertFileAccess(ctx.db, id, user.id);

  const result = yield* Effect.promise(() =>
    ctx.db
      .update(files)
      .set({
        alt,
        aiMetadataEnabled: false,
        updatedAt: Math.max(Date.now(), access.file.updatedAt + 1),
      })
      .where(eq(files.id, id))
      .returning()
      .get(),
  );
  invalidateFile(ctx, access.file.projectId!, [queryKeys.files.list, queryKeys.files.get(id)]);
  return result;
});

export const setFileFilename = Effect.fn("files.setFileFilename")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setFileFilenameInput>,
) {
  const user = yield* requireUser(ctx);
  const { id, filename } = yield* decodeInput(setFileFilenameInput, rawInput);
  const access = yield* assertFileAccess(ctx.db, id, user.id);

  const result = yield* Effect.promise(() =>
    ctx.db
      .update(files)
      .set({ filename, updatedAt: Date.now() })
      .where(eq(files.id, id))
      .returning()
      .get(),
  );
  invalidateFile(ctx, access.file.projectId!, [queryKeys.files.list, queryKeys.files.get(id)]);
  return result;
});

export const deleteFile = Effect.fn("files.deleteFile")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteFileInput>,
) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(deleteFileInput, rawInput);
  const access = yield* assertFileAccess(ctx.db, id, user.id);

  yield* assertNoCollectionAssetUse(ctx.db, [id]);
  const { blockIds, blockPageIds, itemIds } = yield* removeFileReferences(ctx.db, id);

  // Other envs may point at the same R2 blob via push/pull replication. Only
  // drop the blob when this row is the last reference.
  const sibling = yield* Effect.promise(() =>
    ctx.db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.blobId, access.file.blobId), sql`${files.id} != ${id}`))
      .limit(1)
      .get(),
  );
  if (!sibling) {
    yield* deleteFileBlob(ctx, access.file.blobId);
  }
  const result = yield* Effect.promise(() =>
    ctx.db.delete(files).where(eq(files.id, id)).returning().get(),
  );
  invalidateFile(ctx, access.file.projectId!, [
    queryKeys.files.list,
    queryKeys.files.get(id),
    ...blockIds.map((bid) => queryKeys.blocks.get(bid)),
    ...blockPageIds.map((pid) => queryKeys.blocks.getPageMarkdown(pid)),
    ...itemIds.map((iid) => queryKeys.repeatableItems.get(iid)),
    ...(blockIds.length > 0 || itemIds.length > 0
      ? [queryKeys.blocks.getUsageCounts, queryKeys.pages.getByPathAll]
      : []),
  ]);
  return result;
});

export const deleteFiles = Effect.fn("files.deleteFiles")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteFilesInput>,
) {
  const user = yield* requireUser(ctx);
  const { ids } = yield* decodeInput(deleteFilesInput, rawInput);
  if (ids.length === 0) return [];

  const authorizedFiles = yield* Effect.promise(() =>
    ctx.db
      .select({ id: files.id, blobId: files.blobId, projectId: files.projectId })
      .from(files)
      .innerJoin(projects, eq(projects.id, files.projectId))
      .innerJoin(
        member,
        and(eq(member.organizationId, projects.organizationId), eq(member.userId, user.id)),
      )
      .where(inArray(files.id, ids)),
  );

  if (authorizedFiles.length !== ids.length) {
    return yield* new ForbiddenError();
  }

  yield* assertNoCollectionAssetUse(ctx.db, ids);
  const allBlockIds: number[] = [];
  const allBlockPageIds: number[] = [];
  const allItemIds: number[] = [];
  for (const id of ids) {
    const { blockIds, blockPageIds, itemIds } = yield* removeFileReferences(ctx.db, id);
    allBlockIds.push(...blockIds);
    allBlockPageIds.push(...blockPageIds);
    allItemIds.push(...itemIds);
  }

  // Only delete R2 blobs whose last reference is in this batch — other envs
  // may share the same blobId via push/pull replication.
  const blobIds = [...new Set(authorizedFiles.map((f) => f.blobId))];
  const survivors = yield* Effect.promise(() =>
    ctx.db
      .select({ blobId: files.blobId })
      .from(files)
      .where(and(inArray(files.blobId, blobIds), notInArray(files.id, ids))),
  );
  const survivingBlobs = new Set(survivors.map((s) => s.blobId));
  const blobsToDelete = blobIds.filter((b) => !survivingBlobs.has(b));
  yield* Effect.forEach(blobsToDelete, (b) => deleteFileBlob(ctx, b), {
    concurrency: "unbounded",
    discard: true,
  });
  yield* Effect.promise(() => ctx.db.delete(files).where(inArray(files.id, ids)));

  const projectId = authorizedFiles[0]!.projectId!;
  const uniqueBlockIds = [...new Set(allBlockIds)];
  const uniqueBlockPageIds = [...new Set(allBlockPageIds)];
  const uniqueItemIds = [...new Set(allItemIds)];
  invalidateFile(ctx, projectId, [
    queryKeys.files.list,
    ...ids.map((id) => queryKeys.files.get(id)),
    ...uniqueBlockIds.map((id) => queryKeys.blocks.get(id)),
    ...uniqueBlockPageIds.map((id) => queryKeys.blocks.getPageMarkdown(id)),
    ...uniqueItemIds.map((id) => queryKeys.repeatableItems.get(id)),
    ...(uniqueBlockIds.length > 0 || uniqueItemIds.length > 0
      ? [queryKeys.blocks.getUsageCounts, queryKeys.pages.getByPathAll]
      : []),
  ]);
  return ids;
});

export const replaceFile = Effect.fn("files.replaceFile")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof replaceFileInput>,
) {
  const user = yield* requireUser(ctx);
  const { id, newFileId } = yield* decodeInput(replaceFileInput, rawInput);
  if (id === newFileId) {
    return yield* new InvalidInputError({ message: "A file cannot be replaced with itself" });
  }
  const oldAccess = yield* assertFileAccess(ctx.db, id, user.id);
  const newAccess = yield* assertFileAccess(ctx.db, newFileId, user.id);
  if (
    oldAccess.file.projectId !== newAccess.file.projectId ||
    oldAccess.file.environmentId !== newAccess.file.environmentId ||
    oldAccess.file.projectId == null
  ) {
    return yield* new ForbiddenError();
  }
  yield* replaceFileContent(
    ctx,
    { id, projectId: oldAccess.file.projectId },
    newAccess.file,
    {},
    newFileId,
  );
  return { replaced: true };
});

type FileAsset = Pick<
  typeof files.$inferSelect,
  "blobId" | "path" | "url" | "filename" | "mimeType" | "size" | "optimizedSize"
>;

/** Replace bytes and explicit metadata together, retaining the referenced file row. */
export const replaceFileContent = Effect.fn("files.replaceFileContent")(function* (
  ctx: ServiceContext,
  target: z.input<typeof projectFileInput>,
  asset: FileAsset,
  rawMetadata: z.input<typeof fileMetadataInput>,
  temporaryFileId?: number,
) {
  const metadata = yield* decodeInput(fileMetadataInput, rawMetadata);
  const oldFile = yield* getProjectFile(ctx, target);
  if (metadata.aiMetadataEnabled && !isRasterImage(asset.mimeType)) {
    return yield* new InvalidInputError({ message: "Automatic metadata requires a raster image." });
  }
  const { id, projectId } = target;
  const oldUrl = oldFile.url;
  const now = Date.now();
  const scopedBlocks = or(
    inArray(
      blocks.pageId,
      ctx.db
        .select({ id: pages.id })
        .from(pages)
        .where(and(eq(pages.projectId, projectId), eq(pages.environmentId, oldFile.environmentId))),
    ),
    inArray(
      blocks.layoutId,
      ctx.db
        .select({ id: layouts.id })
        .from(layouts)
        .where(
          and(eq(layouts.projectId, projectId), eq(layouts.environmentId, oldFile.environmentId)),
        ),
    ),
  );
  const scopedItems = inArray(
    repeatableItems.blockId,
    ctx.db.select({ id: blocks.id }).from(blocks).where(scopedBlocks),
  );

  // Include direct URLs as well as _fileId references in invalidation.
  const marker = `"_fileId":${id}`;
  const affectedBlocks = yield* Effect.promise(() =>
    ctx.db
      .select({ id: blocks.id, pageId: blocks.pageId })
      .from(blocks)
      .where(
        and(
          scopedBlocks,
          or(
            sql`INSTR(${blocks.content}, ${marker}) > 0`,
            sql`INSTR(${blocks.content}, ${oldUrl}) > 0`,
          ),
        ),
      ),
  );
  const affectedItems = yield* Effect.promise(() =>
    ctx.db
      .select({ id: repeatableItems.id, blockId: repeatableItems.blockId })
      .from(repeatableItems)
      .where(
        and(
          scopedItems,
          or(
            sql`INSTR(${repeatableItems.content}, ${marker}) > 0`,
            sql`INSTR(${repeatableItems.content}, ${oldUrl}) > 0`,
          ),
        ),
      ),
  );

  const itemBlockIds = [...new Set(affectedItems.map((i) => i.blockId))];
  let itemBlockPageIds: number[] = [];
  if (itemBlockIds.length > 0) {
    const parentBlocks = yield* Effect.promise(() =>
      ctx.db
        .select({ id: blocks.id, pageId: blocks.pageId })
        .from(blocks)
        .where(inArray(blocks.id, itemBlockIds)),
    );
    itemBlockPageIds = parentBlocks.map((b) => b.pageId).filter((id): id is number => id != null);
  }
  const allBlockIds = [...new Set([...affectedBlocks.map((b) => b.id), ...itemBlockIds])];
  const allPageIds = [
    ...new Set([
      ...affectedBlocks.map((b) => b.pageId).filter((id): id is number => id != null),
      ...itemBlockPageIds,
    ]),
  ];

  const aiMetadataEnabled = metadata.alt !== undefined ? false : metadata.aiMetadataEnabled;
  // D1 batch is transactional: binary metadata, explicit overrides and URL
  // migrations either commit together or leave the original file untouched.
  const [updated] = yield* Effect.promise(() =>
    ctx.db.batch([
      ctx.db
        .update(files)
        .set({
          blobId: asset.blobId,
          path: asset.path,
          url: asset.url,
          filename: asset.filename,
          mimeType: asset.mimeType,
          size: asset.size,
          optimizedSize: asset.optimizedSize,
          ...(metadata.alt !== undefined ? { alt: metadata.alt } : {}),
          ...(aiMetadataEnabled !== undefined ? { aiMetadataEnabled } : {}),
          updatedAt: sql`MAX(${files.updatedAt} + 1, ${now})`,
        })
        .where(eq(files.id, id))
        .returning(),
      ctx.db
        .update(blocks)
        .set({
          content: sql`REPLACE(CAST(${blocks.content} AS TEXT), ${oldUrl}, ${asset.url})`,
          updatedAt: now,
        })
        .where(and(scopedBlocks, sql`INSTR(${blocks.content}, ${oldUrl}) > 0`)),
      ctx.db
        .update(repeatableItems)
        .set({
          content: sql`REPLACE(CAST(${repeatableItems.content} AS TEXT), ${oldUrl}, ${asset.url})`,
          updatedAt: now,
        })
        .where(and(scopedItems, sql`INSTR(${repeatableItems.content}, ${oldUrl}) > 0`)),
      ...(temporaryFileId === undefined
        ? []
        : [ctx.db.delete(files).where(eq(files.id, temporaryFileId))]),
    ]),
  );
  const result = updated[0];
  if (!result) return yield* new NotFoundError();

  // Cleanup is post-commit; never remove a blob still shared by another environment.
  ctx.waitUntil(Effect.runPromise(deleteUnreferencedFileBlob(ctx, oldFile.blobId)));
  if (result.aiMetadataEnabled !== false && isRasterImage(asset.mimeType)) {
    ctx.waitUntil(
      scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
        entityTable: "files",
        entityId: id,
        type: "fileMetadata",
        delayMs: 0,
      }),
    );
  }

  invalidateFile(ctx, projectId, [
    queryKeys.files.list,
    queryKeys.files.get(id),
    ...(temporaryFileId === undefined ? [] : [queryKeys.files.get(temporaryFileId)]),
    ...allBlockIds.map((bid) => queryKeys.blocks.get(bid)),
    ...allPageIds.map((pid) => queryKeys.blocks.getPageMarkdown(pid)),
    ...affectedItems.map((i) => queryKeys.repeatableItems.get(i.id)),
    ...(allBlockIds.length > 0 || affectedItems.length > 0
      ? [queryKeys.blocks.getUsageCounts, queryKeys.pages.getByPathAll]
      : []),
  ]);
  return result;
});

export const deleteUnreferencedFileBlob = Effect.fn("files.deleteUnreferencedFileBlob")(function* (
  ctx: ServiceContext,
  blobId: string,
) {
  const reference = yield* Effect.promise(() =>
    ctx.db.select({ id: files.id }).from(files).where(eq(files.blobId, blobId)).limit(1).get(),
  );
  if (!reference) yield* deleteFileBlob(ctx, blobId);
});

const deleteFileBlob = Effect.fn("deleteFileBlob")(function* (ctx: ServiceContext, blobId: string) {
  yield* Effect.promise(() =>
    Promise.all([
      ctx.env.FILES_BUCKET.delete(blobId),
      ctx.env.FILES_BUCKET.delete(optimizedVideoKey(blobId)),
    ]),
  );
});

export const setFileAiMetadata = Effect.fn("files.setFileAiMetadata")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setFileAiMetadataInput>,
) {
  const user = yield* requireUser(ctx);
  const { id, enabled } = yield* decodeInput(setFileAiMetadataInput, rawInput);
  const access = yield* assertFileAccess(ctx.db, id, user.id);
  if (enabled && !isRasterImage(access.file.mimeType)) {
    return yield* new InvalidInputError({ message: "Automatic metadata requires a raster image." });
  }

  const result = yield* Effect.promise(() =>
    ctx.db
      .update(files)
      .set({
        aiMetadataEnabled: enabled,
        updatedAt: Math.max(Date.now(), access.file.updatedAt + 1),
      })
      .where(eq(files.id, id))
      .returning()
      .get(),
  );
  if (enabled) {
    ctx.waitUntil(
      scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
        entityTable: "files",
        entityId: id,
        type: "fileMetadata",
        delayMs: 0,
      }),
    );
  }
  invalidateFile(ctx, access.file.projectId!, [queryKeys.files.list, queryKeys.files.get(id)]);
  return result;
});

export const generateFileMetadata = Effect.fn("files.generateFileMetadata")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof generateFileMetadataInput>,
) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(generateFileMetadataInput, rawInput);
  const access = yield* assertFileAccess(ctx.db, id, user.id);

  yield* executeFileMetadata(ctx.db, ctx.env.OPEN_ROUTER_API_KEY, id);
  invalidateFile(ctx, access.file.projectId!, [queryKeys.files.list, queryKeys.files.get(id)]);
  const updated = yield* Effect.promise(() =>
    ctx.db.select().from(files).where(eq(files.id, id)).get(),
  );
  return updated;
});
