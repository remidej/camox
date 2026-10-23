import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import { files } from "../../schema";
import { accepts, fieldsOf, isAsset, pointersOf } from "../_shared/fields";
import type { ServiceContext } from "../_shared/service-context";
import { placeOf, type ContentFinding, type Holder } from "../drafts/content-checks";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { withFileMetadata } from "./generated-metadata";

// What publishing a draft checks about files and the content using them (ADR 0009). Each check
// returns findings in what the draft changed, which block publishing, and the same problems
// already on Live, which are warnings.

type Scope = NonNullable<DraftScope>;

export const FILE_PROBLEM_CODES = [
  "emptyRequiredFile",
  "missingFile",
  "missingFileBytes",
  "unacceptedFileType",
] as const;
export type FileProblemCode = (typeof FILE_PROBLEM_CODES)[number];

/** A problem found in a field of content, or in a file itself (`entity: "file"`). */
export type Finding = {
  entity: Holder["entity"] | "file";
  id: string;
  /** The locale of the content the problem is in, or null for a file, stored once. */
  locale: string | null;
  code: FileProblemCode;
  field: string;
  message: string;
} & Pick<ContentFinding, "fieldKind" | "blockId">;

/**
 * Blockers and warnings about files: empty required image and file fields, references to files that are gone,
 * files the draft adds or replaces whose bytes are missing, and files of a type a field using
 * them doesn't accept.
 */
export const checkFileProblems = Effect.fn("files.checkFileProblems")(function* (
  ctx: ServiceContext,
  scope: Scope,
  holders: Holder[],
) {
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
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
      locale: null,
      code: "missingFileBytes",
      field: "file",
      message: `The stored bytes of "${file.filename}" are missing: upload it again`,
    });
  }

  for (const holder of holders) {
    const draftChangedIt = holder.changed;
    const content = (holder.content ?? {}) as Record<string, unknown>;
    for (const field of fieldsOf(holder.schema)) {
      if (!isAsset(field)) continue;
      const { title } = field;
      const at = {
        entity: holder.entity,
        id: holder.id,
        locale: holder.locale,
        field: field.name,
        ...placeOf(holder, field),
      };
      const fileIds = pointersOf(field, content[field.name]).map((pointer) => pointer.id);

      // Lists can't be required: an empty list is always valid.
      const single = field.kind === "Image" || field.kind === "File";
      if (single && field.required && fileIds.length === 0) {
        (draftChangedIt ? blockers : warnings).push({
          ...at,
          code: "emptyRequiredFile",
          message: `"${title}" is required but empty`,
        });
      }

      for (const fileId of fileIds) {
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
        if (accepts(field, file)) continue;
        (draftChangedIt || replaced.has(fileId) ? blockers : warnings).push({
          ...at,
          code: "unacceptedFileType",
          message: `"${title}" doesn't accept "${file.filename}" (${file.mimeType})`,
        });
      }
    }
  }

  return { blockers, warnings, files: new Map([...liveFiles, ...shownFiles]) };
});
