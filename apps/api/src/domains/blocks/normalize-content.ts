import { Effect } from "effect";
import { generateKeyBetween } from "fractional-indexing";

import { InvalidInputError } from "../../lib/errors";
import { fieldOf } from "../_shared/fields";
import { normalizeFieldValue } from "./asset-value";
import { validateContent } from "./validate-content";

export { sanitizeAssetValue } from "./asset-value";

export type BlockItemSeed = {
  tempId: string;
  parentTempId: string | null;
  fieldName: string;
  content: unknown;
  settings?: unknown;
  position: string;
};

export type SchemaProps = Record<string, FieldSchema>;
/** A stored JSON Schema node, as services pass schemas around. `fieldOf` reads its fields. */
export type FieldSchema = {
  [key: string]: unknown;
  type?: string;
  fieldType?: string;
  enum?: unknown;
  pattern?: string;
  properties?: SchemaProps;
  required?: string[];
  items?: FieldSchema;
  itemSettingsSchema?: FieldSchema;
  minItems?: number;
  maxItems?: number;
};

/** Explicit seeds carry their parent relationships separately from their content. */
export const validateItemSeeds = Effect.fn("validateItemSeeds")(function* (
  seeds: BlockItemSeed[],
  rootProperties: SchemaProps | undefined,
  path = "repeatableItems",
  rootSchema: unknown = { properties: rootProperties },
) {
  // Persistence inserts in array order. Reject ambiguous ancestry rather than
  // validating against a different schema from the one the inserted row uses.
  const schemas = new Map<string, SchemaProps | undefined>();
  for (const [index, seed] of seeds.entries()) {
    if (!seed.tempId) return yield* badRequest("Repeater seed tempId must not be empty", path);
    if (schemas.has(seed.tempId)) return yield* badRequest("Duplicate repeater seed tempId", path);
    if (seed.parentTempId !== null && !schemas.has(seed.parentTempId)) {
      return yield* badRequest("Repeater seed parent must precede its child", path);
    }
    const parentProperties =
      seed.parentTempId === null ? rootProperties : schemas.get(seed.parentTempId);
    const field = fieldOf({ properties: parentProperties }, seed.fieldName);
    if (field && field.kind !== "Repeater") {
      return yield* badRequest(
        `Field "${seed.fieldName}" is not a repeater`,
        `${path}[${index}].fieldName`,
      );
    }
    const schema = field?.itemContentSchema as FieldSchema | undefined;
    schemas.set(seed.tempId, schema?.properties);
    yield* validateContent(seed.content, schema, {
      path: `${path}[${index}].content`,
      rootSchema,
    });
  }
});

function badRequest(message: string, field: string) {
  return new InvalidInputError({ message, data: { field } });
}

/**
 * Normalize block content for createBlock: walks `content` guided by the block
 * definition's `contentSchema`, extracts inline arrays on Repeater fields
 * into seeds (recursively, with `parentTempId` for nested repeaters), and returns
 * content stripped of those fields. The `repeatable_items` table is the source
 * of truth — `getBlock` re-injects `_itemId` markers on read.
 *
 * Seeds are returned in topological order (parents before children) so the
 * existing seed-insertion loop in createBlock can resolve `parentTempId` via
 * `tempIdToRealId`.
 */
export const normalizeBlockContent = Effect.fn("normalizeBlockContent")(function* (
  rawContent: unknown,
  contentSchema: unknown,
  rootSchema: unknown = contentSchema,
) {
  yield* validateContent(rawContent, contentSchema, { rootSchema });
  const ctx = { counter: { v: 0 }, seeds: [] as BlockItemSeed[] };
  const content = yield* walk(rawContent, contentSchema, null, ctx);
  return { content, seeds: ctx.seeds };
});

const walk = Effect.fn("walk")(function* (
  rawContent: unknown,
  schema: unknown,
  parentTempId: string | null,
  ctx: { counter: { v: number }; seeds: BlockItemSeed[] },
): Effect.fn.Return<Record<string, unknown>, InvalidInputError> {
  if (rawContent == null || typeof rawContent !== "object" || Array.isArray(rawContent)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawContent as Record<string, unknown>)) {
    const field = fieldOf(schema, key);
    if (field?.kind === "Repeater") {
      if (value == null) continue;
      if (!Array.isArray(value)) {
        return yield* badRequest(`Field "${key}" is repeatable; expected an array`, key);
      }
      let prevPos: string | null = null;
      for (const element of value) {
        if (element == null || typeof element !== "object" || Array.isArray(element)) {
          return yield* badRequest(`Field "${key}" element must be an object`, key);
        }
        if ("_itemId" in (element as object)) {
          return yield* badRequest(
            `Field "${key}" contains an _itemId marker; cannot reference existing items during create`,
            key,
          );
        }
        const tempId = `__auto_${ctx.counter.v++}`;
        const position = generateKeyBetween(prevPos, null);
        // Push parent before recursing so child seeds appear after their parent (topological order).
        const seed: BlockItemSeed = {
          tempId,
          parentTempId,
          fieldName: key,
          content: {},
          position,
        };
        ctx.seeds.push(seed);
        seed.content = yield* walk(element, field.itemContentSchema, tempId, ctx);
        prevPos = position;
      }
      continue;
    }
    out[key] = normalizeFieldValue(value, field?.kind);
  }
  return out;
});

/**
 * Slim variant of `walk` for repeatable-item content writes. Item content
 * lives in its own DB row, so nested `Repeater` arrays we encounter
 * here belong to grandchild rows that already exist independently — drop
 * them silently rather than re-seeding. Image/File leaks are sanitized.
 */
export const sanitizeItemContent = Effect.fn("sanitizeItemContent")(function* (
  rawContent: unknown,
  itemSchemaProps: SchemaProps | undefined,
  rootSchema: unknown = { properties: itemSchemaProps },
) {
  yield* validateContent(rawContent, { properties: itemSchemaProps }, { rootSchema });
  if (rawContent == null || typeof rawContent !== "object" || Array.isArray(rawContent)) {
    return {} as Record<string, unknown>;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawContent as Record<string, unknown>)) {
    const field = fieldOf({ properties: itemSchemaProps }, key);
    if (field?.kind === "Repeater") continue;
    out[key] = normalizeFieldValue(value, field?.kind);
  }
  return out;
});
