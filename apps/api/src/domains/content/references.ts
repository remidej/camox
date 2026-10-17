import { uuidv7Schema } from "@camox/api-contract/ids";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { lexicalStateToPlainText } from "../../lib/lexical-state";
import { conformRecordContent } from "../_shared/conform-content";
import { type Field, fieldsOf, isAsset, pointersOf, type ReferenceQuery } from "../_shared/fields";
import { type ContentScope, recordsOf } from "../collections/identity";
import { collectionRecords } from "../collections/schema";
import type { FileView } from "../files/generated-metadata";
import { selectInChunks } from "./chunks";
import type { CollectionDefinition, Definitions } from "./definitions";
import { resolveAssets } from "./files";

export type ResolvedReference = {
  id: string;
  collectionId: string;
  label: string;
  content: Record<string, unknown>;
  contentSchema: unknown;
  /** The records this record references, one hop further; absent beyond the second hop. */
  references?: ResolvedReferences;
};

/** Content's resolved references: a record (or null) per reference, records in order per list. */
export type ResolvedReferences = Record<string, ResolvedReference | ResolvedReference[] | null>;

/** Content holding references: its schema, and its conformed values. */
export type Holder = { schema: unknown; content: unknown };

type ReferenceField = Extract<Field, { kind: "Reference" | "ReferenceList" }>;
type ReferenceListField = Extract<Field, { kind: "ReferenceList" }>;
type RecordRow = typeof collectionRecords.$inferSelect;

function isReference(field: Field): field is ReferenceField {
  return field.kind === "Reference" || field.kind === "ReferenceList";
}

/**
 * Text order for query-backed lists: English collation, case-insensitive, numbers by value.
 * Text differing only by case compares equal, so the id tie-break keeps the order deterministic.
 */
const textOrder = new Intl.Collator("en", { numeric: true, sensitivity: "accent" });

/**
 * When a record was first published. A record the draft created sorts as published now, where
 * publishing would put it. A Live record written before publish times were kept falls back to
 * its creation time.
 */
const firstPublished = (now: number) =>
  sql`coalesce(${collectionRecords.firstPublishedAt}, case
    when ${collectionRecords.draftId} is not null and ${collectionRecords.baseVersion} is null
    then ${now} else ${collectionRecords.createdAt} end)`;

/**
 * The records a query-backed list resolves to, in order. `publishedAt` orders by when each
 * record was first published, so editing and republishing a record never reorders it. Empty
 * text sorts last in either direction, and ties break by record id. Without `orderBy`, records
 * keep their creation order. Ordering by time runs in SQL, so only `limit` ids load; ordering by
 * text runs in memory, since the collation is ICU's, loading each candidate's id and raw field
 * value only.
 */
const queryRecordIds = Effect.fn("content.queryRecordIds")(function* (
  db: Database,
  at: ContentScope,
  collectionId: string,
  query: ReferenceQuery,
) {
  const records = recordsOf({ projectId: at.projectId, collectionId }, at.draft);
  const { key, direction } = query.orderBy ?? { key: "createdAt", direction: "asc" };
  if (key === "createdAt" || key === "publishedAt") {
    const sortKey =
      key === "createdAt" ? sql`${collectionRecords.createdAt}` : firstPublished(Date.now());
    const rows = yield* Effect.promise(() =>
      db
        .select({ id: collectionRecords.id })
        .from(collectionRecords)
        .where(records)
        .orderBy(direction === "asc" ? asc(sortKey) : desc(sortKey), asc(collectionRecords.id))
        .limit(query.limit),
    );
    return rows.map((row) => row.id);
  }
  const content = collectionRecords.content;
  const path = `$.${JSON.stringify(key)}`;
  const rows = yield* Effect.promise(() =>
    db
      .select({
        id: collectionRecords.id,
        value: sql<string | null>`case when json_type(${content}, ${path}) = 'text'
          then json_extract(${content}, ${path}) end`,
      })
      .from(collectionRecords)
      .where(records),
  );
  const sign = direction === "asc" ? 1 : -1;
  const keyed = rows.map((row) => {
    const text = row.value === null ? "" : lexicalStateToPlainText(row.value);
    return { id: row.id, key: text === "" ? null : text };
  });
  keyed.sort((a, b) => compareTextKeys(a, b, sign));
  return keyed.slice(0, query.limit).map((candidate) => candidate.id);
});

type TextKey = { id: string; key: string | null };

/** Missing text sorts last in either direction; equal text breaks by id, ascending. */
function compareTextKeys(a: TextKey, b: TextKey, sign: 1 | -1) {
  const byId = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (a.key === null && b.key === null) return byId;
  if (a.key === null) return 1;
  if (b.key === null) return -1;
  return textOrder.compare(a.key, b.key) * sign || byId;
}

/** A record's label: its label field's plain text. */
export function recordLabel(definition: CollectionDefinition, content: Record<string, unknown>) {
  return lexicalStateToPlainText(content[definition.label] as string | Record<string, unknown>);
}

/** What one holder's reference field resolves to, before records load. */
type Plan =
  | { field: ReferenceField; ids: string[] }
  | { field: ReferenceListField; query: string }
  | { field: ReferenceField; gone: true };

/**
 * Resolves the records each holder references, with every record conformed to its collection
 * (ADR 0007). `hops` 2 resolves the records those records reference too, which resolve nothing
 * further: resolution is bounded, so cycles can't expand without limit. A record of a removed
 * collection, a missing record, or one outside the collection the field names resolves to
 * nothing.
 *
 * Each hop loads its records in one query per chunk of ids, plus one query per distinct
 * query-backed list. Record assets stay `{ _fileId }` until `attachFiles` resolves them: their
 * files load with every other file the read places.
 */
export const resolveReferences = Effect.fn("content.resolveReferences")(function* (
  db: Database,
  at: ContentScope,
  definitions: Definitions,
  holders: readonly Holder[],
  hops: 1 | 2,
) {
  const records: ResolvedReference[] = [];
  const loaded = new Map<string, { row: RecordRow; definition: CollectionDefinition } | null>();

  const resolveHop = (
    hopHolders: readonly Holder[],
    hop: 1 | 2,
  ): Effect.Effect<ResolvedReferences[]> =>
    Effect.gen(function* () {
      const plans = hopHolders.map((holder) =>
        fieldsOf(holder.schema)
          .filter(isReference)
          .map((field) => planOf(field, holder.content)),
      );
      if (!plans.some((fields) => fields.length > 0)) return hopHolders.map(() => ({}));
      const collections = yield* definitions.collections();
      for (const fields of plans) {
        for (const [index, plan] of fields.entries()) {
          if (!collections.has(plan.field.collectionId)) {
            fields[index] = { field: plan.field, gone: true };
          }
        }
      }

      // Query-backed lists resolve from their query, once per distinct query.
      const queried = new Map<string, string[]>();
      for (const plan of plans.flat()) {
        if (!("query" in plan) || queried.has(plan.query)) continue;
        const field = plan.field;
        const ids = yield* queryRecordIds(db, at, field.collectionId, field.query!);
        queried.set(plan.query, ids);
      }
      const idsOf = (plan: Plan) =>
        "ids" in plan ? plan.ids : "query" in plan ? queried.get(plan.query)! : [];

      yield* loadRecords(plans.flat().flatMap(idsOf));

      const nodes = new Map<string, ResolvedReference>();
      const nodeOf = (id: string, collectionId: string) => {
        const found = loaded.get(id);
        if (!found || found.row.collectionId !== collectionId) return null;
        const known = nodes.get(id);
        if (known) return known;
        const { row, definition } = found;
        const content = conformRecordContent(definition.contentSchema, row.content);
        const node: ResolvedReference = {
          id: row.id,
          collectionId: definition.collectionId,
          label: recordLabel(definition, content),
          content,
          contentSchema: definition.contentSchema,
        };
        nodes.set(id, node);
        records.push(node);
        return node;
      };
      const resolved = plans.map((fields) => {
        const result: ResolvedReferences = {};
        for (const plan of fields) {
          const { field } = plan;
          const found = idsOf(plan)
            .map((id) => nodeOf(id, field.collectionId))
            .filter((node) => node !== null);
          result[field.name] = field.kind === "Reference" ? (found[0] ?? null) : found;
        }
        return result;
      });

      // Records placed at the first hop resolve their own references; the second hop stops.
      if (hop === 1 && hops === 2) {
        const placed = [...nodes.values()];
        const further = yield* resolveHop(
          placed.map((node) => ({ schema: node.contentSchema, content: node.content })),
          2,
        );
        placed.forEach((node, index) => (node.references = further[index]));
      }
      return resolved;
    });

  /** Loads the records not loaded yet, conformable by their collection. */
  const loadRecords = (ids: readonly string[]) =>
    Effect.gen(function* () {
      const collections = yield* definitions.collections();
      const missing = [...new Set(ids)].filter((id) => !loaded.has(id));
      const rows = yield* selectInChunks(db, at.draft, collectionRecords, missing, (chunk) =>
        and(eq(collectionRecords.projectId, at.projectId), inArray(collectionRecords.id, chunk)),
      );
      for (const id of missing) loaded.set(id, null);
      for (const row of rows) {
        const definition = collections.get(row.collectionId);
        loaded.set(row.id, definition ? { row, definition } : null);
      }
    });

  const references = yield* resolveHop(holders, 1);
  return { references, records };
});

/** The record ids a reference field's value points at, or its query when it is query-backed. */
function planOf(field: ReferenceField, content: unknown): Plan {
  if (field.kind === "ReferenceList" && field.queryBacked) {
    // A query-backed list ignores any stored value: code defines its membership and order.
    return { field, query: `${field.collectionId}\u0000${JSON.stringify(field.query)}` };
  }
  const values = content as Record<string, unknown> | null;
  const ids = pointersOf(field, values?.[field.name])
    .map((pointer) => pointer.id)
    .filter((id) => uuidv7Schema.safeParse(id).success);
  return { field, ids };
}

/** Every file id the resolved records' assets hold. */
export function recordFileIds(records: readonly ResolvedReference[], into: Set<string>) {
  for (const record of records) {
    for (const field of fieldsOf(record.contentSchema).filter(isAsset)) {
      for (const pointer of pointersOf(field, record.content[field.name])) into.add(pointer.id);
    }
  }
}

/** Resolves the resolved records' assets against the files the read loaded. */
export function attachFiles(
  records: readonly ResolvedReference[],
  files: ReadonlyMap<string, FileView>,
) {
  for (const record of records) {
    record.content = resolveAssets(record.contentSchema, record.content, files);
  }
}
