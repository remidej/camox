import { inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { type FileView, withFileMetadata } from "./generated-metadata";
import { files } from "./schema";

/**
 * The files content uses, by id, as the scope reads them: a draft shows its replaced bytes.
 * `collectFileIds` in `_shared/fields.ts` finds the ids.
 */
export const buildFileMap = Effect.fn("files.buildFileMap")(function* (
  db: Database,
  fileIds: Set<string>,
  scope: DraftScope,
) {
  if (fileIds.size === 0) return new Map<string, FileView>();
  const rows = yield* overlay.select(db, scope, files, inArray(files.id, [...fileIds]));
  return new Map((yield* withFileMetadata(db, scope, rows)).map((f) => [f.id, f]));
});
