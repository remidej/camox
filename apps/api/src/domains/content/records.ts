import { Effect } from "effect";

import type { Database } from "../../db";
import { contentToMarkdown } from "../../lib/content-markdown";
import { conformRecordContent } from "../_shared/conform-content";
import type { ContentScope } from "../collections/identity";
import type { collectionRecords } from "../collections/schema";
import type { Definitions } from "./definitions";
import { loadFiles, resolveAssets } from "./files";
import {
  attachFiles,
  recordFileIds,
  recordLabel,
  resolveReferences,
  type ResolvedReferences,
} from "./references";

export type RecordRow = typeof collectionRecords.$inferSelect;

/** A record as readers see it, conformed to its collection (ADR 0007), with its label. */
export type ShownRecord = {
  id: string;
  collectionId: string;
  label: string;
  content: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

/** A record with its files resolved and the records it links, which link nothing further. */
export type RecordView = ShownRecord & { references: ResolvedReferences };

/**
 * Records of one collection as readers see them, in the order given. Records of a collection the
 * scope has no definition for are hidden (ADR 0007): there are none.
 */
export const shownRecords = Effect.fn("content.shownRecords")(function* (
  definitions: Definitions,
  collectionId: string,
  rows: readonly RecordRow[],
) {
  const definition = (yield* definitions.collections()).get(collectionId);
  if (!definition) return [];
  return rows
    .filter((row) => row.collectionId === collectionId)
    .map((row): ShownRecord => {
      const content = conformRecordContent(definition.contentSchema, row.content);
      return {
        id: row.id,
        collectionId,
        label: recordLabel(definition, content),
        content,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
});

/**
 * Records of one collection with their files and the records they link: one query for the
 * linked records, one per query-backed list, and one for every file they place together.
 */
export const recordViews = Effect.fn("content.recordViews")(function* (
  db: Database,
  at: ContentScope,
  definitions: Definitions,
  collectionId: string,
  rows: readonly RecordRow[],
) {
  const shown = yield* shownRecords(definitions, collectionId, rows);
  if (shown.length === 0) return [];
  const schema = (yield* definitions.collections()).get(collectionId)!.contentSchema;
  const linked = yield* resolveReferences(
    db,
    at,
    definitions,
    shown.map((record) => ({ schema, content: record.content })),
    1,
  );
  const fileIds = new Set<string>();
  recordFileIds(
    shown.map((record) => ({ ...record, contentSchema: schema })),
    fileIds,
  );
  recordFileIds(linked.records, fileIds);
  const files = fileIds.size ? yield* loadFiles(db, at, fileIds) : new Map();
  attachFiles(linked.records, files);
  return shown.map((record, index): RecordView => ({
    ...record,
    content: resolveAssets(schema, record.content, files),
    references: linked.references[index]!,
  }));
});

/**
 * A record's Markdown: `toMarkdown` lines, such as a record page layout's, filled with the
 * record's fields and the records it links. Undefined when the record is hidden.
 */
export const recordMarkdown = Effect.fn("content.recordMarkdown")(function* (
  db: Database,
  at: ContentScope,
  definitions: Definitions,
  collectionId: string,
  row: RecordRow,
  toMarkdown: readonly string[],
) {
  const [view] = yield* recordViews(db, at, definitions, collectionId, [row]);
  if (!view) return undefined;
  const schema = (yield* definitions.collections()).get(collectionId)!.contentSchema as {
    properties?: Record<string, unknown>;
  };
  return contentToMarkdown(toMarkdown, schema.properties ?? {}, view.content, {
    references: view.references,
  });
});
