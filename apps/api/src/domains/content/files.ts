import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { files } from "../../schema";
import { assetFileId, fieldsOf, isAsset } from "../_shared/fields";
import type { ContentScope } from "../collections/identity";
import * as overlay from "../drafts/overlay";
import { type FileView, withFileMetadata } from "../files/generated-metadata";

/** An asset as record reads return it: its file reference and the file's current metadata. */
export type ResolvedAsset = {
  _fileId: string;
  url: string;
  alt: string;
  filename: string;
  mimeType: string;
  size: number;
};

// D1 binds at most 100 parameters per statement.
const CHUNK = 90;

/**
 * The files content places, by id, as the scope reads them: a draft shows its replaced bytes,
 * and generated metadata where it applies. Only the project's own files resolve: an id naming
 * another project's file reads as a missing file.
 */
export const loadFiles = Effect.fn("content.loadFiles")(function* (
  db: Database,
  at: ContentScope,
  ids: ReadonlySet<string>,
) {
  const all = [...ids];
  const rows: (typeof files.$inferSelect)[] = [];
  for (let start = 0; start < all.length; start += CHUNK) {
    rows.push(
      ...(yield* overlay.select(
        db,
        at.draft,
        files,
        and(eq(files.projectId, at.projectId), inArray(files.id, all.slice(start, start + CHUNK))),
      )),
    );
  }
  const shown = yield* withFileMetadata(db, at.draft, rows);
  return new Map<string, FileView>(shown.map((file) => [file.id, file]));
});

/**
 * A record's `{ _fileId }` assets resolved against the loaded files. A file that is gone reads
 * as empty: null for a single asset, left out of a list.
 */
export function resolveAssets(
  schema: unknown,
  content: Record<string, unknown>,
  loaded: ReadonlyMap<string, FileView>,
) {
  const resolve = (value: unknown): ResolvedAsset | null => {
    const id = assetFileId(value);
    const file = id === undefined ? undefined : loaded.get(id);
    if (!file) return null;
    const { url, alt, filename, mimeType, size } = file;
    return { _fileId: file.id, url, alt, filename, mimeType, size };
  };
  const resolved = { ...content };
  for (const field of fieldsOf(schema).filter(isAsset)) {
    const value = content[field.name];
    if (field.kind === "Image" || field.kind === "File") {
      resolved[field.name] = resolve(value);
      continue;
    }
    resolved[field.name] = (Array.isArray(value) ? value : [])
      .map(resolve)
      .filter((asset) => asset);
  }
  return resolved;
}
