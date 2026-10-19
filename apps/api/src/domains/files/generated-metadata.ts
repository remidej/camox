import { Effect } from "effect";

import type { Database } from "../../db";
import type { DraftScope, ReadScope } from "../drafts/scope";
import { readValue, readValues, saveValue, type ValueHome } from "../generated-values/service";
import type { files } from "./schema";

// A file's alt text and filename are one group (ADR 0012): all generated or all manual. Manual
// values are content; `null` in both columns means the generated values apply.

type FileRow = typeof files.$inferSelect;

export type FileMetadata = { alt: string; filename: string };

/** A file as readers see it: its metadata in effect, and whether that metadata is generated. */
export type FileView<F extends FileRow = FileRow> = Omit<F, "alt" | "filename"> &
  FileMetadata & { aiMetadata: boolean };

export const metadataKey = (fileId: string) =>
  ({ entity: "file", entityId: fileId, type: "fileMetadata" }) as const;

/** Whether a file's metadata group is generated. */
export const metadataGenerated = (file: Pick<FileRow, "alt" | "filename">) =>
  file.alt === null && file.filename === null;

/** Files with the metadata in effect for the scope: manual values, or generated ones. */
export const withFileMetadata = Effect.fn("files.withFileMetadata")(function* <F extends FileRow>(
  db: Database,
  scope: ReadScope,
  rows: readonly F[],
) {
  const generated = yield* readValues(
    db,
    scope,
    "file",
    "fileMetadata",
    rows.filter(metadataGenerated).map((row) => row.id),
  );
  return rows.map((row): FileView<F> => {
    if (!metadataGenerated(row)) {
      return { ...row, alt: row.alt ?? "", filename: row.filename ?? "", aiMetadata: false };
    }
    const value = generated.get(row.id)?.value;
    return { ...row, alt: value?.alt ?? "", filename: value?.filename ?? "", aiMetadata: true };
  });
});

/** One file with the metadata in effect for the scope. */
export const fileView = Effect.fn("files.fileView")(function* <F extends FileRow>(
  db: Database,
  scope: ReadScope,
  row: F,
) {
  return (yield* withFileMetadata(db, scope, [row]))[0]!;
});

export type MetadataWrite = { alt?: string; filename?: string; aiMetadata?: boolean };

/**
 * The columns a metadata write stores. Writing any field makes the group manual, copying the
 * generated values into the fields not written; making it generated again sets both to null.
 * `generate` tells the caller to request generation.
 */
export const metadataColumns = Effect.fn("files.metadataColumns")(function* (
  db: Database,
  scope: DraftScope,
  file: FileRow,
  write: MetadataWrite,
) {
  if (write.aiMetadata === true) {
    return { columns: { alt: null, filename: null }, generate: true };
  }
  const shown = yield* fileView(db, scope, file);
  if (write.alt === undefined && write.filename === undefined && write.aiMetadata === undefined) {
    return { columns: {}, generate: false };
  }
  return {
    columns: { alt: write.alt ?? shown.alt, filename: write.filename ?? shown.filename },
    generate: false,
  };
});

/**
 * Gives a file whose metadata turns generated a starting value where the scope has none: its
 * metadata so far, until a job generates better.
 */
export const seedMetadata = Effect.fn("files.seedMetadata")(function* (
  db: Database,
  scope: DraftScope,
  home: ValueHome,
  fileId: string,
  metadata: FileMetadata,
) {
  const shown = yield* readValue(db, scope, metadataKey(fileId));
  if (shown.value) return;
  // Seeded before the job is requested, so it doesn't settle that request.
  yield* saveValue(db, home, metadataKey(fileId), metadata, 0);
});
