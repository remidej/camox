import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import { files } from "../../schema";
import { assetFileId, fieldsOf, isAsset, pointersOf } from "../_shared/fields";
import type { ServiceContext } from "../_shared/service-context";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { withFileMetadata } from "../files/generated-metadata";

/** An asset as reads return it: its file reference and the file's current metadata. */
export type ResolvedAsset = {
  _fileId: string;
  url: string;
  alt: string;
  filename: string;
  mimeType: string;
  size: number;
};

/**
 * Resolves a record's `{ _fileId }` assets against the files in its scope, like blocks resolve
 * theirs. A file that is gone reads as empty: null for a single asset, left out of a list.
 */
export const resolveRecordFiles = Effect.fn("collections.resolveRecordFiles")(function* (
  ctx: ServiceContext,
  scope: { projectId: number; draft?: DraftScope },
  schema: unknown,
  content: Record<string, unknown>,
) {
  const assets = fieldsOf(schema).filter(isAsset);
  const ids = new Set(
    assets.flatMap((field) => pointersOf(field, content[field.name]).map((pointer) => pointer.id)),
  );
  if (!ids.size) return content;
  const rows = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(files)
      .where(
        and(
          overlay.visibleIn(files, scope.draft ?? null),
          inArray(files.id, [...ids]),
          eq(files.projectId, scope.projectId),
        ),
      ),
  );
  const shown = yield* withFileMetadata(ctx.db, scope.draft ?? null, rows);
  const byId = new Map(shown.map((file) => [file.id, file]));
  const resolve = (value: unknown): ResolvedAsset | null => {
    const id = assetFileId(value);
    const file = id === undefined ? undefined : byId.get(id);
    if (!file) return null;
    const { url, alt, filename, mimeType, size } = file;
    return { _fileId: file.id, url, alt, filename, mimeType, size };
  };
  const resolved = { ...content };
  for (const field of assets) {
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
});
