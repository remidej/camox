import { type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { InvalidInputError } from "../../lib/errors";
import { inDefaultLocale, type ReadScope } from "../drafts/scope";
import { readValue, readValues, saveValue, type ValueHome } from "../generated-values/service";
import { otherLocaleOf } from "../locales/default-locale";
import { locales } from "../locales/schema";
import { files } from "./schema";

// Files are shared by every locale, but their alt text is per locale (ADR 0012, ADR 0015). In
// the default locale, alt text and filename are one group: all generated or all manual, and
// `null` in both columns means the generated values apply. In other locales, alt text alone is
// generated or manual: a locale's manual alt text is in `altsByLocale`, and without one its alt
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

/** Whether a file's metadata group, its alt text and filename in the default locale, is generated. */
export const metadataGenerated = (file: Pick<FileRow, "alt" | "filename">) =>
  file.alt === null && file.filename === null;

/** Whether a file's alt text in a locale other than the default one, by its tag, is generated. */
export const altGeneratedIn = (file: Pick<FileRow, "altsByLocale">, locale: string) =>
  file.altsByLocale[locale] === undefined;

/**
 * Files with the metadata in effect for the scope, in its locale: manual or generated values.
 * Files of several projects may be read together: each is read in its project's locales.
 */
export const withFileMetadata = Effect.fn("files.withFileMetadata")(function* <F extends FileRow>(
  db: Database,
  scope: ReadScope,
  rows: readonly F[],
) {
  // The default locale's metadata: every locale shows its filename.
  const generated = yield* readValues(
    db,
    inDefaultLocale(scope),
    "file",
    "fileMetadata",
    rows.filter(metadataGenerated).map((row) => row.id),
  );
  const inDefault = (row: F): FileView<F> => {
    if (!metadataGenerated(row)) {
      return { ...row, alt: row.alt ?? "", filename: row.filename ?? "", aiMetadata: false };
    }
    const value = generated.get(row.id)?.value;
    return { ...row, alt: value?.alt ?? "", filename: value?.filename ?? "", aiMetadata: true };
  };

  const localeOf = new Map<number, string | undefined>();
  for (const projectId of new Set(rows.map((row) => row.projectId))) {
    localeOf.set(projectId, yield* otherLocaleOf(db, scope, projectId));
  }
  const inOther = rows.filter((row) => {
    const locale = localeOf.get(row.projectId);
    return locale !== undefined && altGeneratedIn(row, locale);
  });
  const localized = yield* readValues(
    db,
    scope,
    "file",
    "fileMetadata",
    inOther.map((row) => row.id),
  );
  return rows.map((row): FileView<F> => {
    const shown = inDefault(row);
    const locale = localeOf.get(row.projectId);
    if (locale === undefined) return shown;
    if (!altGeneratedIn(row, locale)) {
      return { ...shown, alt: row.altsByLocale[locale]!, aiMetadata: false };
    }
    return { ...shown, alt: localized.get(row.id)?.value?.alt ?? "", aiMetadata: true };
  });
});

/**
 * Run once Live holds what a publish leaves: drops Live files' manual alt texts in locales Live
 * doesn't have, so a locale removed and later added again starts from generated alt text.
 */
export function publishStatements(projectId: number): SQL[] {
  return [
    sql`update ${files} set ${sql.identifier(files.altsByLocale.name)} = (
        select coalesce(json_group_object("a"."key", "a"."value"), '{}')
        from json_each(${files.altsByLocale}) as "a"
        where "a"."key" in (select ${locales.tag} from ${locales} where ${locales.projectId} = ${projectId} and ${locales.draftId} is null))
      where ${files.draftId} is null and ${files.projectId} = ${projectId} and ${files.altsByLocale} != '{}'`,
  ];
}

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
    const { [locale]: _alt, ...others } = file.altsByLocale;
    if (write.aiMetadata === true) {
      return { columns: { altsByLocale: others }, generate: true };
    }
    if (write.alt === undefined && write.aiMetadata === undefined) {
      return { columns: {}, generate: false };
    }
    const shown = yield* fileView(db, scope, file);
    return {
      columns: { altsByLocale: { ...others, [locale]: write.alt ?? shown.alt } },
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
