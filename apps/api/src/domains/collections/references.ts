import { isQueryBacked, referenceQueryProblem } from "@camox/api-contract";
import { uuidv7Schema } from "@camox/api-contract/ids";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import { InvalidInputError } from "../../lib/errors";
import { definitionsIn } from "../_shared/definitions";
import { fieldsOf, pointersOf } from "../_shared/fields";
import type { ServiceContext } from "../_shared/service-context";
import * as overlay from "../drafts/overlay";
import type { ReadScope } from "../drafts/scope";
import { collectionOfRecord, type ContentScope } from "./identity";
import { collectionDefinitions, collectionRecords } from "./schema";
import { validatePageLink } from "./text-content";

// Writing references: their schemas and values are checked here. Reads resolve them through the
// content reader (`domains/content`).

/** A node of a stored schema, walked whatever its place in the schema. */
type SchemaNode = Record<string, unknown>;

/**
 * References and reference lists are supported at the top level of block content and of
 * repeatable item content, at any repeater depth. Fail closed for other shapes, such as
 * settings, item settings or nested objects.
 */
export function validateReferenceSchema(schema: unknown, allow = true) {
  const allowed = new Set<unknown>();
  const collect = (content: unknown) => {
    for (const field of fieldsOf(content)) {
      if (field.kind === "Reference" || field.kind === "ReferenceList") allowed.add(field.schema);
      if (field.kind === "Repeater") collect(field.itemContentSchema);
    }
  };
  if (allow) collect(schema);
  /** `parentKey` is the key holding `value`, named in query errors. */
  function visit(value: unknown, parentKey: string): InvalidInputError | undefined {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) {
        const error = visit(child, parentKey);
        if (error) return error;
      }
      return;
    }
    const field = value as SchemaNode;
    const kind = field.kind ?? field.fieldType;
    if (kind === "ReferenceList" || kind === "Reference") {
      if (field.fieldType !== kind || !allowed.has(field)) {
        return new InvalidInputError({
          message: "References and reference lists are only supported in block and item content",
        });
      }
      if (typeof field.collectionId !== "string" || !field.collectionId) {
        return new InvalidInputError({ message: "Reference requires collectionId" });
      }
      if (isQueryBacked(field)) {
        const problem =
          kind === "Reference" ? "only reference lists take a query" : queryProblem(field);
        if (problem) return new InvalidInputError({ message: `${parentKey}: ${problem}` });
      }
    }
    for (const [key, child] of Object.entries(field)) {
      // A reference carries its collection's schema, which collection sync validates.
      if (key === "referenceSchema" && (kind === "Reference" || kind === "ReferenceList")) continue;
      if (key === "query" && (kind === "Reference" || kind === "ReferenceList")) continue;
      const error = visit(child, key);
      if (error) return error;
    }
  }
  const error = visit(schema, "");
  return error ? Effect.fail(error) : Effect.void;
}

/**
 * Why a reference list's query is invalid, if it is. Ordering keys must name a text field of
 * the collection (from the content schema the field carries) or system metadata.
 */
function queryProblem(field: SchemaNode) {
  const properties = (
    field.referenceSchema as { properties?: Record<string, SchemaNode> } | undefined
  )?.properties;
  return referenceQueryProblem(field.query, (key) =>
    properties && Object.hasOwn(properties, key) ? properties[key]?.fieldType : undefined,
  );
}

/**
 * Validates reference values and page links in scope: in `content` itself and, for inline
 * repeatable items (block patches and bundles reconstructed from item seeds), in each item's
 * content too. Item markers (`{ _itemId }`) carry no content of their own here.
 */
export const validateReferenceValues = Effect.fn("collections.validateReferenceValues")(function* (
  ctx: ServiceContext,
  scope: ContentScope | SyncScope,
  schema: unknown,
  content: unknown,
  path = "",
): Effect.fn.Return<void, InvalidInputError> {
  const values = content as Record<string, unknown> | null;
  for (const field of fieldsOf(schema)) {
    const { name } = field;
    const value = values?.[name];
    if (value === undefined) continue;
    if (field.kind === "Reference") {
      if (value === null) continue;
      if (!(yield* recordInScope(ctx, scope, field, value)))
        return yield* missingReference(path + name);
      continue;
    }
    if (field.kind === "ReferenceList") {
      if (field.queryBacked) {
        return yield* new InvalidInputError({
          message: `${path}${name}: query-backed reference lists are resolved, not written`,
        });
      }
      if (!Array.isArray(value))
        return yield* invalidList(path + name, "must be an array of record ids");
      if (new Set(value).size !== value.length) {
        return yield* invalidList(path + name, "links the same record more than once");
      }
      if (field.maxItems !== undefined && value.length > field.maxItems) {
        return yield* invalidList(path + name, `links more than ${field.maxItems} records`);
      }
      for (const id of value) {
        if (!(yield* recordInScope(ctx, scope, field, id)))
          return yield* missingReference(path + name);
      }
      continue;
    }
    if (field.kind === "String" || field.kind === "Link") {
      for (const pointer of pointersOf(field, value)) {
        yield* validatePageLink(ctx, scope, pointer.id);
      }
      continue;
    }
    if (field.kind !== "Repeater" || !Array.isArray(value)) continue;
    for (const [index, item] of value.entries()) {
      if (!item || typeof item !== "object") continue;
      yield* validateReferenceValues(
        ctx,
        scope,
        field.itemContentSchema,
        item,
        `${path}${name}[${index}].`,
      );
    }
  }
});

/**
 * Where a sync checks the content a Definition Set declares. The collections the target holds
 * come from the set (`collections`), since the target only holds them once the sync's batch ran.
 */
export type SyncScope = ContentScope & { collections: ReadonlySet<string> };

/**
 * Whether `value` names a record of the field's collection, visible in `scope`, in a collection
 * the scope holds: one of the set's for a sync (`SyncScope`), a stored definition otherwise.
 */
export const recordInScope = Effect.fn("collections.recordInScope")(function* (
  ctx: ServiceContext,
  scope: ContentScope | SyncScope,
  field: { collectionId?: unknown },
  value: unknown,
) {
  const validId = uuidv7Schema.safeParse(value);
  if (!validId.success) return false;
  const collectionId = String(field.collectionId);
  const synced = "collections" in scope ? scope.collections : undefined;
  if (synced && !synced.has(collectionId)) return false;
  const inCollection = and(
    eq(collectionRecords.id, validId.data),
    overlay.visibleIn(collectionRecords, scope.draft),
    eq(collectionRecords.projectId, scope.projectId),
    eq(collectionRecords.collectionId, collectionId),
  );
  const records = ctx.db.select({ id: collectionRecords.id }).from(collectionRecords);
  const record = yield* Effect.promise(() =>
    synced
      ? records.where(inCollection).get()
      : records
          .innerJoin(collectionDefinitions, collectionOfRecord)
          .where(and(inCollection, definitionsIn(collectionDefinitions, scope.draft)))
          .get(),
  );
  return !!record;
});

function invalidList(name: string, problem: string) {
  return new InvalidInputError({ message: `${name}: reference list ${problem}` });
}

export function missingReference(name: string) {
  return new InvalidInputError({
    message: `${name}: reference is missing or outside this collection/project`,
  });
}

/**
 * The project a block belongs to, whether on a page or in a layout, read as Live or as `draft`.
 */
export function blockScope(block: { projectId: number }, draft: ReadScope): ContentScope {
  return { projectId: block.projectId, draft };
}
