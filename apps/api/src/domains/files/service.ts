import { uuidv7Schema } from "@camox/api-contract/ids";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import type { Database } from "../../db";
import { AiModel } from "../../lib/ai-model";
import { decodeInput, InvalidInputError, NotFoundError } from "../../lib/errors";
import { isRasterImage } from "../../lib/image-transform";
import type { Journal } from "../../lib/journal";
import type { AiCallError } from "../../lib/retry-ai-call";
import { files } from "../../schema";
import { referencesTo } from "../_shared/references-to";
import type { ServiceContext } from "../_shared/service-context";
import { accessTo, type ContentAccess } from "../drafts/access";
import * as overlay from "../drafts/overlay";
import { type Draft, draftOf, type DraftScope, inLocale, type ReadScope } from "../drafts/scope";
import {
  generateNow,
  requestGeneration,
  requestGenerations,
  type Stale,
} from "../generated-values/generation";
import { homeOf, saveValue, settleRequest } from "../generated-values/service";
import { defaultLocaleTag, otherLocaleOf } from "../locales/default-locale";
import { INITIAL_LOCALE, locales } from "../locales/schema";
import {
  altGeneratedIn,
  fileView,
  metadataColumns,
  metadataGenerated,
  metadataKey,
  type MetadataWrite,
  seedMetadata,
  withFileMetadata,
} from "./generated-metadata";
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

// --- AI Executor ---

/**
 * Generates a file's metadata as the scope reads it, in its locale, into the scope's generated
 * values: never into the file, so it never copies one into a draft (ADR 0012). Files whose
 * metadata is manual in the locale are skipped. Outside the default locale, only the alt text is
 * generated: the filename is the default locale's.
 */
export const executeFileMetadata = Effect.fn("files.executeFileMetadata")(function* (
  db: Database,
  scope: ReadScope,
  fileId: string,
  startedAt: number,
): Effect.fn.Return<Stale | null, AiCallError, AiModel | Journal> {
  const file = yield* overlay.get(db, scope, files, fileId);
  if (!file?.projectId) return null;
  const home = homeOf(scope, file.projectId);
  const locale = yield* otherLocaleOf(db, scope, file.projectId);
  const generated = locale === undefined ? metadataGenerated(file) : altGeneratedIn(file, locale);
  if (!generated || !isRasterImage(file.mimeType)) {
    yield* settleRequest(db, home, metadataKey(fileId), startedAt);
    return null;
  }
  const shown = yield* fileView(db, scope, file);

  const model = yield* AiModel;
  const metadata = yield* model.imageMetadata({
    locale: locale ?? (yield* defaultLocaleTag(db, file.projectId)) ?? INITIAL_LOCALE,
    url: file.url,
    mimeType: file.mimeType,
    filename: shown.filename,
  });
  yield* saveValue(
    db,
    home,
    metadataKey(fileId),
    locale === undefined
      ? { alt: metadata.alt, filename: metadata.filename }
      : { alt: metadata.alt },
    startedAt,
  );
  // A file's metadata makes nothing else stale.
  return null;
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

export const listFiles = Effect.fn("files.listFiles")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listFilesInput>,
) {
  const { projectId } = yield* decodeInput(listFilesInput, rawInput);
  const { scope } = yield* accessTo(ctx, { project: projectId }, "public");
  const rows = yield* overlay.select(ctx.db, scope, files, eq(files.projectId, projectId));
  return yield* withFileMetadata(ctx.db, scope, rows);
}, Effect.scoped);

export const getFile = Effect.fn("files.getFile")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getFileInput>,
) {
  const { id } = yield* decodeInput(getFileInput, rawInput);
  const { scope, entity: file } = yield* accessTo(ctx, { file: id }, "public");
  return yield* fileView(ctx.db, scope, file);
}, Effect.scoped);

/** How many pieces of content use the file, as the scope sees them. */
export const getFileUsageCount = Effect.fn("files.getFileUsageCount")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getFileUsageCountInput>,
) {
  const { id } = yield* decodeInput(getFileUsageCountInput, rawInput);
  const { scope, entity: file } = yield* accessTo(ctx, { file: id }, "public");

  const uses = yield* referencesTo(
    ctx.db,
    { projectId: file.projectId, draft: scope },
    { kind: "file", id: file.id },
  );
  return { count: uses.length };
}, Effect.scoped);

// Authenticated, project-scoped access for agent tools.
export const getProjectFile = Effect.fn("files.getProjectFile")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof projectFileInput>,
) {
  const { projectId, id } = yield* decodeInput(projectFileInput, rawInput);
  const { scope, entity: file } = yield* accessTo({ ...ctx, projectId }, { file: id }, "member");
  return yield* fileView(ctx.db, scope, file);
}, Effect.scoped);

// --- Writes ---

/** Changes a file as the scope reads it: in a draft, the first change copies it there. */
const writeFile = Effect.fn("files.writeFile")(function* (
  ctx: ServiceContext,
  scope: Draft,
  file: FileRow,
  patch: Partial<FileRow>,
) {
  const { id: _id, rowId: _rowId, ...values } = patch;
  const result = yield* overlay.update(ctx.db, scope, files, file.id, {
    ...values,
    updatedAt: Math.max(Date.now(), file.updatedAt + 1),
  });
  if (!result) return yield* new NotFoundError();
  return result;
});

/**
 * Writes a file's metadata group (ADR 0012): any field makes it manual, copying the generated
 * values into the fields not written; `aiMetadata: true` makes it generated again and requests
 * generation, starting from the metadata shown so far.
 */
const writeMetadata = Effect.fn("files.writeMetadata")(function* (
  ctx: ServiceContext,
  scope: Draft,
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
    yield* requestGeneration(ctx.db, home, { entity: "file", row: result });
  }
  return yield* fileView(ctx.db, scope, result);
});

export const updateFile = Effect.fn("files.updateFile")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof updateFileInput>,
) {
  const input = yield* decodeInput(updateFileInput, rawInput);
  const bound = { ...ctx, projectId: input.projectId };
  const { scope, entity: file } = yield* accessTo(bound, { file: input.id }, "write");
  return yield* writeMetadata(ctx, scope, file, input);
}, Effect.scoped);

export const setFileAlt = Effect.fn("files.setFileAlt")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setFileAltInput>,
) {
  const { id, alt } = yield* decodeInput(setFileAltInput, rawInput);
  const { scope, entity: file } = yield* accessTo(ctx, { file: id }, "write");
  return yield* writeMetadata(ctx, scope, file, { alt });
}, Effect.scoped);

export const setFileFilename = Effect.fn("files.setFileFilename")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setFileFilenameInput>,
) {
  const { id, filename } = yield* decodeInput(setFileFilenameInput, rawInput);
  const { scope, entity: file } = yield* accessTo(ctx, { file: id }, "write");
  return yield* writeMetadata(ctx, scope, file, { filename });
}, Effect.scoped);

/**
 * Deletes files as the scope reads them. Content that uses them is left alone: publishing a
 * draft that deletes a file still in use is blocked until the content is fixed (ADR 0009).
 */
const removeFiles = Effect.fn("files.removeFiles")(function* (
  ctx: ServiceContext,
  scope: Draft,
  shown: FileRow[],
) {
  for (const file of shown) yield* overlay.remove(ctx.db, scope, files, file.id);
  // A draft's tombstone still names the blob Live serves; a deleted row names nothing.
  yield* deleteUnreferencedBlobs(
    ctx,
    shown.map((file) => file.blobId),
  );
});

export const deleteFile = Effect.fn("files.deleteFile")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteFileInput>,
) {
  const { id } = yield* decodeInput(deleteFileInput, rawInput);
  const { scope, entity: file } = yield* accessTo(ctx, { file: id }, "write");
  yield* removeFiles(ctx, scope, [file]);
  return file;
}, Effect.scoped);

export const deleteFiles = Effect.fn("files.deleteFiles")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteFilesInput>,
) {
  const { ids } = yield* decodeInput(deleteFilesInput, rawInput);
  const [first] = ids;
  if (first === undefined) return [];
  // Access to the first file names the project and draft; every file must be in them.
  const { scope, project } = yield* accessTo(ctx, { file: first }, "write");
  const shown = yield* overlay.select(
    ctx.db,
    scope,
    files,
    and(inArray(files.id, ids), eq(files.projectId, project.id)),
  );
  if (shown.length !== new Set(ids).size) return yield* new NotFoundError();
  yield* removeFiles(ctx, scope, shown);
  return ids;
}, Effect.scoped);

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
  { scope, entity: file }: ContentAccess<{ file: string }, "write">,
  asset: FileAsset,
  rawMetadata: z.input<typeof fileMetadataInput>,
) {
  const metadata = yield* decodeInput(fileMetadataInput, rawMetadata);
  // The metadata the default locale shows, which the new upload's starts from.
  const oldFile = yield* fileView(ctx.db, draftOf(scope), file);
  const target = { projectId: file.projectId };
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
    const home = homeOf(draftOf(scope), target.projectId);
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
    yield* requestGeneration(ctx.db, home, { entity: "file", row: result });
  }
  if (metadata.aiMetadata !== false) yield* requestInOtherLocales(ctx.db, scope, result);
  return yield* fileView(ctx.db, scope, result);
});

/**
 * Requests an uploaded or replaced image's alt text in every locale but the default one, where
 * the caller requests its metadata: files are shared by every locale, each with its own alt text
 * (ADR 0015). A locale whose alt text is manual keeps it.
 */
const requestInOtherLocales = Effect.fn("files.requestInOtherLocales")(function* (
  db: Database,
  scope: Draft,
  file: FileRow,
) {
  const draft = draftOf(scope);
  const others = yield* overlay.select(
    db,
    draft,
    locales,
    and(eq(locales.projectId, file.projectId), eq(locales.isDefault, false)),
  );
  yield* requestGenerations(
    db,
    others.map(({ tag }) => ({
      home: homeOf(inLocale(draft, tag), file.projectId),
      target: { entity: "file", row: file },
    })),
  );
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
  scope: Draft,
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
    const home = homeOf(draftOf(scope), values.projectId);
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
    yield* requestGeneration(ctx.db, home, { entity: "file", row: created });
  }
  if (aiMetadata !== false) yield* requestInOtherLocales(ctx.db, scope, created);
  return yield* fileView(ctx.db, scope, created);
});

export const setFileAiMetadata = Effect.fn("files.setFileAiMetadata")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setFileAiMetadataInput>,
) {
  const { id, enabled } = yield* decodeInput(setFileAiMetadataInput, rawInput);
  const { scope, entity: file } = yield* accessTo(ctx, { file: id }, "write");
  return yield* writeMetadata(ctx, scope, file, { aiMetadata: enabled });
}, Effect.scoped);

/** Generates a file's metadata now, into the scope's generated values. */
export const generateFileMetadata = Effect.fn("files.generateFileMetadata")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof generateFileMetadataInput>,
) {
  const { id } = yield* decodeInput(generateFileMetadataInput, rawInput);
  const { scope } = yield* accessTo(ctx, { file: id }, "member");

  yield* generateNow(ctx.db, scope, "file", id).pipe(Effect.orDie);
  const shown = yield* overlay.get(ctx.db, scope, files, id);
  return shown ? yield* fileView(ctx.db, scope, shown) : undefined;
}, Effect.scoped);
