import { uuidv7Schema } from "@camox/api-contract/ids";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import { files } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import * as overlay from "../drafts/overlay";

type Field = { fieldType?: string };

/** The `_fileId` of an asset value, as stored or as resolved on read. */
export function assetFileId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const id = uuidv7Schema.safeParse((value as Record<string, unknown>)._fileId);
  return id.success ? id.data : undefined;
}

/** An asset as reads return it: its file reference and the file's current metadata. */
export type ResolvedAsset = {
  _fileId: string;
  url: string;
  alt: string;
  filename: string;
  mimeType: string;
  size: number;
};

const isAssetField = (field: Field) => field.fieldType === "Image" || field.fieldType === "File";
const isAssetListField = (field: Field) =>
  field.fieldType === "ImageList" || field.fieldType === "FileList";

/**
 * Resolves a record's `{ _fileId }` assets against the files in its scope, like blocks resolve
 * theirs. A file that is gone reads as empty: null for a single asset, left out of a list.
 */
export const resolveRecordFiles = Effect.fn("collections.resolveRecordFiles")(function* (
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  schema: unknown,
  content: Record<string, unknown>,
) {
  const properties = Object.entries(
    (schema as { properties?: Record<string, Field> } | null)?.properties ?? {},
  );
  const ids = new Set<string>();
  for (const [key, field] of properties) {
    const value = content[key];
    if (isAssetField(field)) {
      const id = assetFileId(value);
      if (id !== undefined) ids.add(id);
    }
    if (isAssetListField(field) && Array.isArray(value)) {
      for (const entry of value) {
        const id = assetFileId(entry);
        if (id !== undefined) ids.add(id);
      }
    }
  }
  if (!ids.size) return content;
  const rows = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(files)
      .where(
        and(
          overlay.visibleIn(files, null),
          inArray(files.id, [...ids]),
          eq(files.projectId, scope.projectId),
          eq(files.environmentId, scope.environmentId),
        ),
      ),
  );
  const byId = new Map(rows.map((file) => [file.id, file]));
  const resolve = (value: unknown): ResolvedAsset | null => {
    const id = assetFileId(value);
    const file = id === undefined ? undefined : byId.get(id);
    if (!file) return null;
    const { url, alt, filename, mimeType, size } = file;
    return { _fileId: file.id, url, alt, filename, mimeType, size };
  };
  const resolved = { ...content };
  for (const [key, field] of properties) {
    const value = content[key];
    if (isAssetField(field)) resolved[key] = resolve(value);
    if (isAssetListField(field)) {
      resolved[key] = (Array.isArray(value) ? value : []).map(resolve).filter((asset) => asset);
    }
  }
  return resolved;
});
