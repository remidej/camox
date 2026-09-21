import { queryKeys } from "@camox/api-contract/query-keys";
import { ORPCError } from "@orpc/server";
import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { outdent } from "outdent";
import { z } from "zod";

import { assertFileAccess, getAuthorizedProject } from "../../authorization";
import type { Database } from "../../db";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { isRasterImage, transformImageUrl } from "../../lib/image-transform";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { scheduleAiJob } from "../../lib/schedule-ai-job";
import { blocks, files, member, projects, repeatableItems } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";

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

function assertUser(ctx: ServiceContext) {
  if (!ctx.user) throw new ORPCError("UNAUTHORIZED");
  return ctx.user;
}

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

async function generateImageMetadata(
  apiKey: string,
  imageUrl: string,
  imageMimeType: string,
  currentFilename: string,
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
  const response = await fetch(optimizedUrl);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  const mimeType = response.headers.get("content-type") || "image/jpeg";

  return await chat({
    adapter: createOpenRouterText("google/gemini-2.5-flash-lite", apiKey),
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
            source: { type: "data" as const, value: base64, mimeType: mimeType as "image/png" },
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
  });
}

export async function executeFileMetadata(db: Database, apiKey: string, fileId: number) {
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file || file.aiMetadataEnabled === false) return;
  if (!isRasterImage(file.mimeType)) return;

  const metadata = await generateImageMetadata(apiKey, file.url, file.mimeType, file.filename);
  await saveGeneratedFileMetadata(db, file, metadata);
}

export async function saveGeneratedFileMetadata(
  db: Database,
  file: Pick<typeof files.$inferSelect, "id" | "updatedAt">,
  metadata: { filename: string; alt: string },
) {
  await db
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
    );
}

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

export async function removeFileReferences(db: Database, fileId: number) {
  const marker = `"_fileId":${fileId}`;
  const now = Date.now();

  const affectedBlocks = await db
    .select({ id: blocks.id, content: blocks.content, pageId: blocks.pageId })
    .from(blocks)
    .where(sql`INSTR(${blocks.content}, ${marker}) > 0`);

  const affectedItems = await db
    .select({
      id: repeatableItems.id,
      content: repeatableItems.content,
      blockId: repeatableItems.blockId,
    })
    .from(repeatableItems)
    .where(sql`INSTR(${repeatableItems.content}, ${marker}) > 0`);

  for (const block of affectedBlocks) {
    const cleaned = cleanFileReferences(block.content as JsonValue, fileId);
    await db
      .update(blocks)
      .set({ content: cleaned, updatedAt: now })
      .where(eq(blocks.id, block.id));
  }

  for (const item of affectedItems) {
    const cleaned = cleanFileReferences(item.content as JsonValue, fileId);
    await db
      .update(repeatableItems)
      .set({ content: cleaned, updatedAt: now })
      .where(eq(repeatableItems.id, item.id));
  }

  const itemBlockIds = affectedItems.map((i) => i.blockId);
  const allBlockIds = [...new Set([...affectedBlocks.map((b) => b.id), ...itemBlockIds])];

  // Look up pageIds for blocks referenced by affected repeatable items
  let itemBlockPageIds: number[] = [];
  if (itemBlockIds.length > 0) {
    const uniqueItemBlockIds = [...new Set(itemBlockIds)];
    const parentBlocks = await db
      .select({ id: blocks.id, pageId: blocks.pageId })
      .from(blocks)
      .where(inArray(blocks.id, uniqueItemBlockIds));
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
}

// --- Reads ---

export async function listFiles(ctx: ServiceContext, rawInput: z.input<typeof listFilesInput>) {
  const { projectId } = listFilesInput.parse(rawInput);
  const environment = await resolveEnvironment(ctx.db, projectId, ctx.environmentName);
  return ctx.db
    .select()
    .from(files)
    .where(and(eq(files.projectId, projectId), eq(files.environmentId, environment.id)));
}

export async function getFile(ctx: ServiceContext, rawInput: z.input<typeof getFileInput>) {
  const { id } = getFileInput.parse(rawInput);
  const result = await ctx.db.select().from(files).where(eq(files.id, id)).get();
  if (!result) throw new ORPCError("NOT_FOUND");
  return result;
}

export async function getFileUsageCount(
  ctx: ServiceContext,
  rawInput: z.input<typeof getFileUsageCountInput>,
) {
  const { id } = getFileUsageCountInput.parse(rawInput);
  const file = await ctx.db.select().from(files).where(eq(files.id, id)).get();
  if (!file) throw new ORPCError("NOT_FOUND");

  const marker = `"_fileId":${file.id}`;
  const blockCount = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(blocks)
    .where(sql`INSTR(${blocks.content}, ${marker}) > 0`)
    .get();
  const itemCount = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(repeatableItems)
    .where(sql`INSTR(${repeatableItems.content}, ${marker}) > 0`)
    .get();
  return { count: (blockCount?.count ?? 0) + (itemCount?.count ?? 0) };
}

// Authenticated, project/environment-scoped access for agent tools.
export async function getProjectFile(
  ctx: ServiceContext,
  rawInput: z.input<typeof projectFileInput>,
) {
  const user = assertUser(ctx);
  const { projectId, id } = projectFileInput.parse(rawInput);
  const project = await getAuthorizedProject(ctx.db, projectId, user.id);
  if (!project) throw new ORPCError("NOT_FOUND");
  const environment = await resolveEnvironment(ctx.db, projectId, ctx.environmentName);
  const file = await ctx.db
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, id),
        eq(files.projectId, projectId),
        eq(files.environmentId, environment.id),
      ),
    )
    .get();
  if (!file) throw new ORPCError("NOT_FOUND");
  return file;
}

// --- Writes ---

export async function updateFile(ctx: ServiceContext, rawInput: z.input<typeof updateFileInput>) {
  const input = updateFileInput.parse(rawInput);
  const file = await getProjectFile(ctx, input);
  if (input.aiMetadataEnabled && !isRasterImage(file.mimeType)) {
    throw new ORPCError("BAD_REQUEST", { message: "Automatic metadata requires a raster image." });
  }
  const aiMetadataEnabled = input.alt !== undefined ? false : input.aiMetadataEnabled;
  const result = await ctx.db
    .update(files)
    .set({
      ...(input.alt !== undefined ? { alt: input.alt } : {}),
      ...(input.filename !== undefined ? { filename: input.filename } : {}),
      ...(aiMetadataEnabled !== undefined ? { aiMetadataEnabled } : {}),
      updatedAt: Math.max(Date.now(), file.updatedAt + 1),
    })
    .where(eq(files.id, file.id))
    .returning()
    .get();
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
}

export async function setFileAlt(ctx: ServiceContext, rawInput: z.input<typeof setFileAltInput>) {
  const user = assertUser(ctx);
  const { id, alt } = setFileAltInput.parse(rawInput);
  const access = await assertFileAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  const result = await ctx.db
    .update(files)
    .set({
      alt,
      aiMetadataEnabled: false,
      updatedAt: Math.max(Date.now(), access.file.updatedAt + 1),
    })
    .where(eq(files.id, id))
    .returning()
    .get();
  invalidateFile(ctx, access.file.projectId!, [queryKeys.files.list, queryKeys.files.get(id)]);
  return result;
}

export async function setFileFilename(
  ctx: ServiceContext,
  rawInput: z.input<typeof setFileFilenameInput>,
) {
  const user = assertUser(ctx);
  const { id, filename } = setFileFilenameInput.parse(rawInput);
  const access = await assertFileAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  const result = await ctx.db
    .update(files)
    .set({ filename, updatedAt: Date.now() })
    .where(eq(files.id, id))
    .returning()
    .get();
  invalidateFile(ctx, access.file.projectId!, [queryKeys.files.list, queryKeys.files.get(id)]);
  return result;
}

export async function deleteFile(ctx: ServiceContext, rawInput: z.input<typeof deleteFileInput>) {
  const user = assertUser(ctx);
  const { id } = deleteFileInput.parse(rawInput);
  const access = await assertFileAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  const { blockIds, blockPageIds, itemIds } = await removeFileReferences(ctx.db, id);

  // Other envs may point at the same R2 blob via push/pull replication. Only
  // drop the blob when this row is the last reference.
  const sibling = await ctx.db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.blobId, access.file.blobId), sql`${files.id} != ${id}`))
    .limit(1)
    .get();
  if (!sibling) {
    await ctx.env.FILES_BUCKET.delete(access.file.blobId);
  }
  const result = await ctx.db.delete(files).where(eq(files.id, id)).returning().get();
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
}

export async function deleteFiles(ctx: ServiceContext, rawInput: z.input<typeof deleteFilesInput>) {
  const user = assertUser(ctx);
  const { ids } = deleteFilesInput.parse(rawInput);
  if (ids.length === 0) return [];

  const authorizedFiles = await ctx.db
    .select({ id: files.id, blobId: files.blobId, projectId: files.projectId })
    .from(files)
    .innerJoin(projects, eq(projects.id, files.projectId))
    .innerJoin(
      member,
      and(eq(member.organizationId, projects.organizationId), eq(member.userId, user.id)),
    )
    .where(inArray(files.id, ids));

  if (authorizedFiles.length !== ids.length) {
    throw new ORPCError("FORBIDDEN");
  }

  const allBlockIds: number[] = [];
  const allBlockPageIds: number[] = [];
  const allItemIds: number[] = [];
  for (const id of ids) {
    const { blockIds, blockPageIds, itemIds } = await removeFileReferences(ctx.db, id);
    allBlockIds.push(...blockIds);
    allBlockPageIds.push(...blockPageIds);
    allItemIds.push(...itemIds);
  }

  // Only delete R2 blobs whose last reference is in this batch — other envs
  // may share the same blobId via push/pull replication.
  const blobIds = [...new Set(authorizedFiles.map((f) => f.blobId))];
  const survivors = await ctx.db
    .select({ blobId: files.blobId })
    .from(files)
    .where(and(inArray(files.blobId, blobIds), notInArray(files.id, ids)));
  const survivingBlobs = new Set(survivors.map((s) => s.blobId));
  const blobsToDelete = blobIds.filter((b) => !survivingBlobs.has(b));
  await Promise.all(blobsToDelete.map((b) => ctx.env.FILES_BUCKET.delete(b)));
  await ctx.db.delete(files).where(inArray(files.id, ids));

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
}

export async function replaceFile(ctx: ServiceContext, rawInput: z.input<typeof replaceFileInput>) {
  const user = assertUser(ctx);
  const { id, newFileId } = replaceFileInput.parse(rawInput);
  if (id === newFileId) throw new ORPCError("BAD_REQUEST");
  const oldAccess = await assertFileAccess(ctx.db, id, user.id);
  const newAccess = await assertFileAccess(ctx.db, newFileId, user.id);
  if (!oldAccess || !newAccess) throw new ORPCError("NOT_FOUND");
  if (oldAccess.file.projectId !== newAccess.file.projectId) {
    throw new ORPCError("FORBIDDEN");
  }

  const oldUrl = oldAccess.file.url;
  const oldBlobId = oldAccess.file.blobId;
  const newAsset = newAccess.file;
  const now = Date.now();

  // Move the new asset onto the old file row. The id stays the same so
  // every `_fileId: <id>` reference automatically resolves to the new asset.
  await ctx.db
    .update(files)
    .set({
      blobId: newAsset.blobId,
      path: newAsset.path,
      url: newAsset.url,
      filename: newAsset.filename,
      mimeType: newAsset.mimeType,
      size: newAsset.size,
      updatedAt: now,
    })
    .where(eq(files.id, id));

  // Drop the temporary file row created by the upload step.
  await ctx.db.delete(files).where(eq(files.id, newFileId));

  // Migrate any rich-text/HTML content that embeds the old URL directly.
  await ctx.db
    .update(blocks)
    .set({
      content: sql`REPLACE(CAST(${blocks.content} AS TEXT), ${oldUrl}, ${newAsset.url})`,
      updatedAt: now,
    })
    .where(sql`INSTR(${blocks.content}, ${oldUrl}) > 0`);
  await ctx.db
    .update(repeatableItems)
    .set({
      content: sql`REPLACE(CAST(${repeatableItems.content} AS TEXT), ${oldUrl}, ${newAsset.url})`,
      updatedAt: now,
    })
    .where(sql`INSTR(${repeatableItems.content}, ${oldUrl}) > 0`);

  // Find blocks/items referencing the file by _fileId so we can invalidate them.
  const marker = `"_fileId":${id}`;
  const affectedBlocks = await ctx.db
    .select({ id: blocks.id, pageId: blocks.pageId })
    .from(blocks)
    .where(sql`INSTR(${blocks.content}, ${marker}) > 0`);
  const affectedItems = await ctx.db
    .select({ id: repeatableItems.id, blockId: repeatableItems.blockId })
    .from(repeatableItems)
    .where(sql`INSTR(${repeatableItems.content}, ${marker}) > 0`);

  const itemBlockIds = [...new Set(affectedItems.map((i) => i.blockId))];
  let itemBlockPageIds: number[] = [];
  if (itemBlockIds.length > 0) {
    const parentBlocks = await ctx.db
      .select({ id: blocks.id, pageId: blocks.pageId })
      .from(blocks)
      .where(inArray(blocks.id, itemBlockIds));
    itemBlockPageIds = parentBlocks.map((b) => b.pageId).filter((id): id is number => id != null);
  }
  const allBlockIds = [...new Set([...affectedBlocks.map((b) => b.id), ...itemBlockIds])];
  const allPageIds = [
    ...new Set([
      ...affectedBlocks.map((b) => b.pageId).filter((id): id is number => id != null),
      ...itemBlockPageIds,
    ]),
  ];

  // Drop the old R2 blob now that nothing references it — unless another env
  // still points at the same blobId via push/pull replication. At this point
  // the row at `id` already points at the new blob and the `newFileId` row is
  // gone, so any remaining row pointing at `oldBlobId` is a sibling we must
  // preserve.
  const oldBlobSibling = await ctx.db
    .select({ id: files.id })
    .from(files)
    .where(eq(files.blobId, oldBlobId))
    .limit(1)
    .get();
  if (!oldBlobSibling) {
    await ctx.env.FILES_BUCKET.delete(oldBlobId);
  }

  // Re-run AI metadata if it was enabled and the new asset is a raster image
  // (vision model can't analyze SVG/PDF/etc.).
  if (oldAccess.file.aiMetadataEnabled !== false && isRasterImage(newAsset.mimeType)) {
    ctx.waitUntil(
      scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
        entityTable: "files",
        entityId: id,
        type: "fileMetadata",
        delayMs: 0,
      }),
    );
  }

  invalidateFile(ctx, oldAccess.file.projectId!, [
    queryKeys.files.list,
    queryKeys.files.get(id),
    queryKeys.files.get(newFileId),
    ...allBlockIds.map((bid) => queryKeys.blocks.get(bid)),
    ...allPageIds.map((pid) => queryKeys.blocks.getPageMarkdown(pid)),
    ...affectedItems.map((i) => queryKeys.repeatableItems.get(i.id)),
    ...(allBlockIds.length > 0 || affectedItems.length > 0
      ? [queryKeys.blocks.getUsageCounts, queryKeys.pages.getByPathAll]
      : []),
  ]);
  return { replaced: true };
}

export async function setFileAiMetadata(
  ctx: ServiceContext,
  rawInput: z.input<typeof setFileAiMetadataInput>,
) {
  const user = assertUser(ctx);
  const { id, enabled } = setFileAiMetadataInput.parse(rawInput);
  const access = await assertFileAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");
  if (enabled && !isRasterImage(access.file.mimeType)) throw new ORPCError("BAD_REQUEST");

  const result = await ctx.db
    .update(files)
    .set({ aiMetadataEnabled: enabled, updatedAt: Math.max(Date.now(), access.file.updatedAt + 1) })
    .where(eq(files.id, id))
    .returning()
    .get();
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
}

export async function generateFileMetadata(
  ctx: ServiceContext,
  rawInput: z.input<typeof generateFileMetadataInput>,
) {
  const user = assertUser(ctx);
  const { id } = generateFileMetadataInput.parse(rawInput);
  const access = await assertFileAccess(ctx.db, id, user.id);
  if (!access) throw new ORPCError("NOT_FOUND");

  await executeFileMetadata(ctx.db, ctx.env.OPEN_ROUTER_API_KEY, id);
  invalidateFile(ctx, access.file.projectId!, [queryKeys.files.list, queryKeys.files.get(id)]);
  const updated = await ctx.db.select().from(files).where(eq(files.id, id)).get();
  return updated;
}
