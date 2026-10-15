import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import { blockDefinitions, blocks, files } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { withFileMetadata } from "./generated-metadata";

// What publishing a draft checks about files and the content using them (ADR 0009). Each check
// returns findings in what the draft changed, which block publishing, and the same problems
// already on Live, which are warnings.

type Scope = NonNullable<DraftScope>;
type BlockRow = typeof blocks.$inferSelect;

export type FileProblemCode =
  | "emptyRequiredFile"
  | "missingFile"
  | "missingFileBytes"
  | "unacceptedFileType";

/** A problem found in a block's field, or in a file itself (`entity: "file"`). */
export type Finding = {
  entity: "block" | "file";
  id: string;
  code: FileProblemCode;
  field: string;
  message: string;
};

type FieldSchema = {
  fieldType?: string;
  required?: unknown;
  title?: string;
  accept?: unknown;
  items?: { accept?: unknown };
};

const ASSET_FIELDS = new Set(["Image", "File", "ImageList", "FileList"]);

/** The content schemas of a project's block definitions, by name. Synced placements hold none. */
const definitionsOf = Effect.fn("files.definitionsOf")(function* (
  ctx: ServiceContext,
  projectId: number,
) {
  const rows = yield* Effect.promise(() =>
    ctx.db.select().from(blockDefinitions).where(eq(blockDefinitions.projectId, projectId)),
  );
  const fields = new Map<string, [string, FieldSchema][]>();
  for (const definition of rows) {
    if (definition.synced) continue;
    const properties =
      (definition.contentSchema as { properties?: Record<string, FieldSchema> }).properties ?? {};
    fields.set(definition.blockId, Object.entries(properties));
  }
  return fields;
});

/** Every `_fileId` anywhere in a value. */
function fileIdsIn(value: unknown, found: string[] = []): string[] {
  if (value === null || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const entry of value) fileIdsIn(entry, found);
    return found;
  }
  const record = value as Record<string, unknown>;
  if (typeof record._fileId === "string") found.push(record._fileId);
  for (const [key, entry] of Object.entries(record)) {
    if (key !== "_fileId") fileIdsIn(entry, found);
  }
  return found;
}

/** Whether an image or file field holds no file: placeholders and hydrated shapes don't count. */
function isEmpty(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  return typeof (value as { _fileId?: unknown })._fileId !== "string";
}

/** Whether a file matches one of a field's `accept` entries: a MIME type, `type/*`, or `.ext`. */
export function accepts(accept: string[], file: { mimeType: string; filename: string }) {
  const mimeType = file.mimeType.toLowerCase();
  return accept.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (entry === "*" || entry === "*/*") return true;
    if (entry.startsWith(".")) return file.filename.toLowerCase().endsWith(entry);
    if (entry.endsWith("/*")) return mimeType.startsWith(entry.slice(0, -1));
    return mimeType === entry;
  });
}

function acceptOf(schema: FieldSchema): string[] | undefined {
  const accept = schema.fieldType?.endsWith("List") ? schema.items?.accept : schema.accept;
  if (!Array.isArray(accept)) return undefined;
  return accept.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Blockers and warnings about files: empty required image and file fields, references to files that are gone,
 * files the draft adds or replaces whose bytes are missing, and files of a type a field using
 * them doesn't accept.
 */
export const checkFileProblems = Effect.fn("files.checkFileProblems")(function* (
  ctx: ServiceContext,
  scope: Scope,
  { changed, untouched }: { changed: BlockRow[]; untouched: BlockRow[] },
) {
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  const definitions = yield* definitionsOf(ctx, scope.projectId);
  const inProject = eq(files.projectId, scope.projectId);
  const shownFiles = new Map(
    (yield* withFileMetadata(
      ctx.db,
      scope,
      yield* overlay.select(ctx.db, scope, files, inProject),
    )).map((file) => [file.id, file]),
  );
  const liveFiles = new Map(
    (yield* withFileMetadata(
      ctx.db,
      null,
      yield* overlay.select(ctx.db, null, files, inProject),
    )).map((file) => [file.id, file]),
  );

  // Files the draft uploads or replaces: new bytes Live doesn't serve yet.
  const stored = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(files)
      .where(and(overlay.storedIn(files, scope), eq(files.deleted, false))),
  );
  const newBytes = stored.filter((file) => liveFiles.get(file.id)?.blobId !== file.blobId);
  const replaced = new Set(newBytes.filter((file) => liveFiles.has(file.id)).map((f) => f.id));

  // One HEAD per file with new bytes.
  for (const file of newBytes) {
    const head = yield* Effect.promise(() => ctx.env.FILES_BUCKET.head(file.blobId));
    if (head) continue;
    blockers.push({
      entity: "file",
      id: file.id,
      code: "missingFileBytes",
      field: "file",
      message: `The stored bytes of "${file.filename}" are missing: upload it again`,
    });
  }

  const check = (block: BlockRow, draftChangedIt: boolean) => {
    const content = (block.content ?? {}) as Record<string, unknown>;
    for (const [field, schema] of definitions.get(block.type) ?? []) {
      const title = schema.title ?? field;
      const value = content[field];
      const at = { entity: "block" as const, id: block.id, field };

      // Lists can't be required: an empty list is always valid.
      const single = schema.fieldType === "Image" || schema.fieldType === "File";
      if (single && schema.required === true && isEmpty(value)) {
        (draftChangedIt ? blockers : warnings).push({
          ...at,
          code: "emptyRequiredFile",
          message: `"${title}" is required but empty`,
        });
      }

      if (!ASSET_FIELDS.has(schema.fieldType ?? "")) continue;
      const accept = acceptOf(schema);
      for (const fileId of new Set(fileIdsIn(value))) {
        const file = shownFiles.get(fileId);
        if (!file) {
          // Untouched content pointing at a file the draft deletes is the draft's problem too.
          const draftDeletedIt = liveFiles.has(fileId);
          (draftChangedIt || draftDeletedIt ? blockers : warnings).push({
            ...at,
            code: "missingFile",
            message: `"${title}" uses a file that doesn't exist`,
          });
          continue;
        }
        if (!accept || accepts(accept, file)) continue;
        (draftChangedIt || replaced.has(fileId) ? blockers : warnings).push({
          ...at,
          code: "unacceptedFileType",
          message: `"${title}" doesn't accept "${file.filename}" (${file.mimeType})`,
        });
      }
    }
  };
  for (const block of changed) check(block, true);
  for (const block of untouched) check(block, false);

  return { blockers, warnings, files: new Map([...liveFiles, ...shownFiles]) };
});
