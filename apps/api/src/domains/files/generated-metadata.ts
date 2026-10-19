import { Effect } from "effect";

import type { Database } from "../../db";
import { InvalidInputError } from "../../lib/errors";
import { inDefaultLocale, type ReadScope } from "../drafts/scope";
import {
  defaultLocaleTag,
  readValue,
  readValues,
  saveValue,
  type ValueHome,
} from "../generated-values/service";
import type { files } from "./schema";

// Files are shared by every locale, but their alt text is per locale (ADR 0012, ADR 0015). In
// the default locale, alt text and filename are one group: all generated or all manual, and
// `null` in both columns means the generated values apply. In other locales, alt text alone is
// generated or manual: a locale's manual alt text is in `localizedAlts`, and without one its alt
// text is generated in that locale. The filename is the default locale's everywhere.

type FileRow = typeof files.$inferSelect;

export type FileMetadata = { alt: string; filename: string };

/**
 * A file as readers see it: its metadata in effect in the scope's locale, and whether that
 * locale's metadata is generated.
 */
export type FileView<F extends FileRow = FileRow> = Omit<F, "alt" | "filename"> &
  FileMetadata & { aiMetadata: boolean };

export const metadataKey = (fileId: string) =>
  ({ entity: "file", entityId: fileId, type: "fileMetadata" }) as const;

/**
 * Whether a file's metadata is generated in a locale other than the default one, named by its
 * tag, or without one in the default locale.
 */
export const metadataGenerated = (
  file: Pick<FileRow, "alt" | "filename"> & Partial<Pick<FileRow, "localizedAlts">>,
  locale?: string,
) =>
  locale === undefined
    ? file.alt === null && file.filename === null
    : file.localizedAlts?.[locale] === undefined;

/**
 * The locale a scope reads a project's files in, when it isn't the default one: its tag, or
 * undefined in the default locale.
 */
export const otherLocaleOf = Effect.fn("files.otherLocaleOf")(function* (
  db: Database,
  scope: ReadScope,
  projectId: number,
) {
  const locale = scope?.locale;
  if (locale === undefined) return undefined;
  return locale === (yield* defaultLocaleTag(db, projectId)) ? undefined : locale;
});

/** Files with the metadata in effect for the scope, in its locale: manual or generated values. */
export const withFileMetadata = Effect.fn("files.withFileMetadata")(function* <F extends FileRow>(
  db: Database,
  scope: ReadScope,
  rows: readonly F[],
) {
  const fallback = inDefaultLocale(scope);
  const generated = yield* readValues(
    db,
    fallback,
    "file",
    "fileMetadata",
    rows.filter((row) => metadataGenerated(row)).map((row) => row.id),
  );
  const inDefault = (row: F): FileView<F> => {
    if (!metadataGenerated(row)) {
      return { ...row, alt: row.alt ?? "", filename: row.filename ?? "", aiMetadata: false };
    }
    const value = generated.get(row.id)?.value;
    return {
      ...row,
      alt: value?.alt ?? "",
      filename: value?.filename ?? "",
      aiMetadata: true,
    };
  };

  // Files of other projects can't be in one read: the locale is the first file's project's.
  const locale = rows[0] ? yield* otherLocaleOf(db, scope, rows[0].projectId) : undefined;
  if (locale === undefined) return rows.map(inDefault);
  const localized = yield* readValues(
    db,
    scope,
    "file",
    "fileMetadata",
    rows.filter((row) => metadataGenerated(row, locale)).map((row) => row.id),
  );
  return rows.map((row): FileView<F> => {
    const { filename } = inDefault(row);
    if (!metadataGenerated(row, locale)) {
      return { ...row, alt: row.localizedAlts[locale]!, filename, aiMetadata: false };
    }
    const alt = localized.get(row.id)?.value?.alt ?? "";
    return { ...row, alt, filename, aiMetadata: true };
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
 * The columns a metadata write stores in the scope's locale. In the default locale, writing any
 * field makes the group manual, copying the generated values into the fields not written; making
 * it generated again sets both to null. In another locale, only the alt text is written, and the
 * filename, which is the default locale's, can't be. `generate` tells the caller to request
 * generation.
 */
export const metadataColumns = Effect.fn("files.metadataColumns")(function* (
  db: Database,
  scope: ReadScope,
  file: FileRow,
  write: MetadataWrite,
) {
  const locale = yield* otherLocaleOf(db, scope, file.projectId);
  if (locale !== undefined) {
    if (write.filename !== undefined) {
      return yield* new InvalidInputError({
        message: "Every locale shares the default locale's filename: set it there",
      });
    }
    const { [locale]: _alt, ...others } = file.localizedAlts;
    if (write.aiMetadata === true) {
      return { columns: { localizedAlts: others }, generate: true };
    }
    if (write.alt === undefined && write.aiMetadata === undefined) {
      return { columns: {}, generate: false };
    }
    const shown = yield* fileView(db, scope, file);
    return {
      columns: { localizedAlts: { ...others, [locale]: write.alt ?? shown.alt } },
      generate: false,
    };
  }
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
  scope: ReadScope,
  home: ValueHome,
  fileId: string,
  metadata: FileMetadata,
) {
  const shown = yield* readValue(db, scope, metadataKey(fileId));
  if (shown.value) return;
  const locale = yield* otherLocaleOf(db, scope, home.projectId);
  // Seeded before the job is requested, so it doesn't settle that request.
  yield* saveValue(
    db,
    home,
    metadataKey(fileId),
    locale === undefined ? metadata : { alt: metadata.alt },
    0,
  );
});
