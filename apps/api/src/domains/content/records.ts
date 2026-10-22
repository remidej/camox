import { Effect } from "effect";

import type { Database } from "../../db";
import { contentToMarkdown } from "../../lib/content-markdown";
import { conformRecordContent } from "../_shared/conform-content";
import { propertiesOf } from "../_shared/fields";
import type { ContentScope } from "../collections/identity";
import type { collectionRecords } from "../collections/schema";
import type { FileView } from "../files/generated-metadata";
import type { Definitions } from "./definitions";
import { loadFiles, resolveAssets } from "./files";
import {
  attachFiles,
  recordFileIds,
  recordText,
  type RecordText,
  resolveReferences,
  type ResolvedReference,
  type ResolvedReferences,
} from "./references";
import { recordNode, recordStructuredData } from "./structured-data";

/** What reads need of a stored record. */
export type RecordRow = Pick<
  typeof collectionRecords.$inferSelect,
  "id" | "collectionId" | "content" | "createdAt" | "updatedAt"
>;

/**
 * A record as readers see it, conformed to its collection (ADR 0007), with its title and
 * description.
 */
export type ShownRecord = RecordText & {
  id: string;
  collectionId: string;
  content: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

/** A record with its files resolved and the records it references, which resolve nothing further. */
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
        ...recordText(definition, content),
        content,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
});

/**
 * Records of one collection with their files and the records they reference: one query for the
 * referenced records, one per query-backed list, and one for every file they place together.
 */
export const recordViews = Effect.fn("content.recordViews")(function* (
  db: Database,
  at: ContentScope,
  definitions: Definitions,
  collectionId: string,
  rows: readonly RecordRow[],
) {
  return (yield* loadRecordViews(db, at, definitions, collectionId, rows, 1)).views;
});

/**
 * Records of one collection as `recordViews` reads them, each with its Structured Data: its own
 * node, and the nodes of the records it references and of those they link. The records it
 * references resolve their own references for their nodes, at the cost of one more query per
 * chunk of ids, but `references` still holds the first hop only.
 */
export const describedRecordViews = Effect.fn("content.describedRecordViews")(function* (
  db: Database,
  at: ContentScope,
  definitions: Definitions,
  collectionId: string,
  rows: readonly RecordRow[],
) {
  const { views, files, schema } = yield* loadRecordViews(
    db,
    at,
    definitions,
    collectionId,
    rows,
    2,
  );
  const collections = yield* definitions.collections();
  return views.map((view) => {
    const node = recordNode(collections, { ...view, contentSchema: schema }, files);
    const records = recordStructuredData(collections, [view.references], files);
    return {
      ...view,
      references: firstHop(view.references),
      structuredData: { ...(node && { node }), records },
    };
  });
});

/** References as the first hop shows them: their records link nothing further. */
function firstHop(references: ResolvedReferences): ResolvedReferences {
  const strip = ({ references: _further, ...record }: ResolvedReference) => record;
  return Object.fromEntries(
    Object.entries(references).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.map(strip) : value && strip(value),
    ]),
  );
}

const loadRecordViews = Effect.fn("content.loadRecordViews")(function* (
  db: Database,
  at: ContentScope,
  definitions: Definitions,
  collectionId: string,
  rows: readonly RecordRow[],
  hops: 1 | 2,
) {
  const shown = yield* shownRecords(definitions, collectionId, rows);
  if (shown.length === 0) return { views: [], files: new Map<string, FileView>(), schema: {} };
  const schema = (yield* definitions.collections()).get(collectionId)!.contentSchema;
  const resolved = yield* resolveReferences(
    db,
    at,
    definitions,
    shown.map((record) => ({ schema, content: record.content })),
    hops,
  );
  const fileIds = new Set<string>();
  recordFileIds(
    shown.map((record) => ({ ...record, contentSchema: schema })),
    fileIds,
  );
  recordFileIds(resolved.records, fileIds);
  const files: ReadonlyMap<string, FileView> = fileIds.size
    ? yield* loadFiles(db, at, fileIds)
    : new Map();
  attachFiles(resolved.records, files);
  const views = shown.map((record, index): RecordView => ({
    ...record,
    content: resolveAssets(schema, record.content, files),
    references: resolved.references[index]!,
  }));
  return { views, files, schema };
});

/**
 * A record's Markdown: `toMarkdown` lines, such as a record page layout's, filled with the
 * record's fields and the records it references. Undefined when the record is hidden.
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
  const schema = (yield* definitions.collections()).get(collectionId)!.contentSchema;
  return contentToMarkdown(toMarkdown, propertiesOf(schema), view.content, {
    references: view.references,
  });
});
