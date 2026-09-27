import { validateIconValue } from "@camox/api-contract";
import { ORPCError } from "@orpc/server";
import { generateKeyBetween } from "fractional-indexing";

export type BlockItemSeed = {
  tempId: string;
  parentTempId: string | null;
  fieldName: string;
  content: unknown;
  position: string;
};

export type SchemaProps = Record<string, FieldSchema>;
type FieldSchema = {
  fieldType?: string;
  enum?: unknown;
  pattern?: string;
  items?: { properties?: SchemaProps };
};

/**
 * Preflight only submitted Embed fields, before a write can mutate any rows.
 * Omitted fields (including historical invalid values) are intentionally ignored.
 */
export function validateEmbedContent(
  content: unknown,
  properties: SchemaProps | undefined,
  path = "content",
): void {
  if (!content || typeof content !== "object" || Array.isArray(content)) return;
  for (const [key, value] of Object.entries(content)) {
    const schema = properties?.[key];
    const field = `${path}.${key}`;
    if (schema?.fieldType === "Embed") {
      if (typeof value !== "string") {
        let received: string = typeof value;
        if (value === null) received = "null";
        if (Array.isArray(value)) received = "array";
        badRequest(`Invalid value at ${field}: expected a string, received ${received}`, field);
      }
      if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
        badRequest(`Invalid value at ${field}: string does not match the Embed pattern`, field);
      }
      continue;
    }
    if (schema?.fieldType !== "Repeater" || !Array.isArray(value)) continue;
    value.forEach((item, index) =>
      validateEmbedContent(item, schema.items?.properties, `${field}[${index}]`),
    );
  }
}

/** Explicit seeds carry their parent relationships separately from their content. */
export function validateEmbedSeeds(
  seeds: BlockItemSeed[],
  rootProperties: SchemaProps | undefined,
  path = "repeatableItems",
): void {
  // Persistence inserts in array order. Reject ambiguous ancestry rather than
  // validating against a different schema from the one the inserted row uses.
  const schemas = new Map<string, SchemaProps | undefined>();
  for (const [index, seed] of seeds.entries()) {
    if (!seed.tempId) badRequest("Repeater seed tempId must not be empty", path);
    if (schemas.has(seed.tempId)) badRequest("Duplicate repeater seed tempId", path);
    if (seed.parentTempId !== null && !schemas.has(seed.parentTempId)) {
      badRequest("Repeater seed parent must precede its child", path);
    }
    const parentProperties =
      seed.parentTempId === null ? rootProperties : schemas.get(seed.parentTempId);
    const properties = parentProperties?.[seed.fieldName]?.items?.properties;
    schemas.set(seed.tempId, properties);
    validateEmbedContent(seed.content, properties, `${path}[${index}].content`);
  }
}

export function assertIconValue(value: unknown, schema: FieldSchema | undefined, field: string) {
  if (!schema) return;
  try {
    validateIconValue(value, schema);
  } catch {
    badRequest(`Invalid icon ID for "${field}"`, field);
  }
}

function badRequest(message: string, field: string): never {
  throw new ORPCError("BAD_REQUEST", { message, data: { field } });
}

/**
 * Canonicalize an Image/File field value: keep `{ _fileId: number }` markers
 * (dropping any sibling props like `url`/`alt` the AI may have invented),
 * coerce string ids to number, and reduce anything else to `null`. The
 * frontend renders its own placeholder for null, so we never persist
 * AI-fabricated URLs.
 */
export function sanitizeAssetValue(value: unknown): { _fileId: number } | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)._fileId;
  if (raw == null) return null;
  const id = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(id)) return null;
  return { _fileId: id };
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
export function normalizeBlockContent(
  rawContent: unknown,
  contentSchema: unknown,
): { content: Record<string, unknown>; seeds: BlockItemSeed[] } {
  const schemaProps = (contentSchema as { properties?: SchemaProps } | null)?.properties;
  validateEmbedContent(rawContent, schemaProps);
  const ctx = { counter: { v: 0 }, seeds: [] as BlockItemSeed[] };
  const content = walk(rawContent, schemaProps, null, ctx);
  return { content, seeds: ctx.seeds };
}

function walk(
  rawContent: unknown,
  schemaProps: SchemaProps | undefined,
  parentTempId: string | null,
  ctx: { counter: { v: number }; seeds: BlockItemSeed[] },
): Record<string, unknown> {
  if (rawContent == null || typeof rawContent !== "object" || Array.isArray(rawContent)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawContent as Record<string, unknown>)) {
    const fieldSchema = schemaProps?.[key];
    assertIconValue(value, fieldSchema, key);
    if (fieldSchema?.fieldType === "Repeater") {
      if (value == null) continue;
      if (!Array.isArray(value)) {
        badRequest(`Field "${key}" is repeatable; expected an array`, key);
      }
      const itemSchemaProps = fieldSchema.items?.properties;
      let prevPos: string | null = null;
      for (const element of value) {
        if (element == null || typeof element !== "object" || Array.isArray(element)) {
          badRequest(`Field "${key}" element must be an object`, key);
        }
        if ("_itemId" in (element as object)) {
          badRequest(
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
        seed.content = walk(element, itemSchemaProps, tempId, ctx);
        prevPos = position;
      }
      continue;
    }
    if (fieldSchema?.fieldType === "Image" || fieldSchema?.fieldType === "File") {
      out[key] = sanitizeAssetValue(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Slim variant of `walk` for repeatable-item content writes. Item content
 * lives in its own DB row, so nested `Repeater` arrays we encounter
 * here belong to grandchild rows that already exist independently — drop
 * them silently rather than re-seeding. Image/File leaks are sanitized.
 */
export function sanitizeItemContent(
  rawContent: unknown,
  itemSchemaProps: SchemaProps | undefined,
): Record<string, unknown> {
  validateEmbedContent(rawContent, itemSchemaProps);
  if (rawContent == null || typeof rawContent !== "object" || Array.isArray(rawContent)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawContent as Record<string, unknown>)) {
    const fieldSchema = itemSchemaProps?.[key];
    assertIconValue(value, fieldSchema, key);
    if (fieldSchema?.fieldType === "Repeater") continue;
    if (fieldSchema?.fieldType === "Image" || fieldSchema?.fieldType === "File") {
      out[key] = sanitizeAssetValue(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}
