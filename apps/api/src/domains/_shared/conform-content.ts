import { and, eq } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { z } from "zod";

import { isLexicalState, lexicalStateToPlainText } from "../../lib/lexical-state";
import { blockDefinitions } from "../block-definitions/schema";
import { normalizeFieldValue } from "../blocks/asset-value";
import { validateContent } from "../blocks/validate-content";
import type { DraftScope } from "../drafts/scope";
import { definitionsIn } from "./definitions";
import { assetFileId, defaultOf, type Field, fieldsOf, itemSchemas } from "./fields";
import type { ServiceContext } from "./service-context";

/**
 * Conforming content to its definitions (ADR 0007). Stored content keeps whatever shape it
 * was written in; every read that returns content passes it through here first, so what
 * comes out is typed exactly by the definitions in effect:
 * - unknown keys are dropped;
 * - missing fields get their defaults;
 * - values of the wrong kind are replaced by the default;
 * - repeatable items under a removed repeater are left out;
 * - collection fields without a default get an empty value of their kind.
 * Nothing here writes: the stored content is left as it is, so a field that comes back
 * finds its content again.
 */

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Whether a write would accept this value for the field: the same check, applied on read. */
function blockValueHasKind(field: Field, value: unknown, rootSchema: unknown) {
  const exit = Effect.runSyncExit(
    validateContent(
      { value },
      { type: "object", properties: { value: field.schema } },
      { rootSchema },
    ),
  );
  return Exit.isSuccess(exit);
}

/**
 * Block and repeatable item content or settings. Repeaters are stored as item rows, so their
 * keys are left for the caller to fill with item markers. Asset defaults are render-only
 * placeholders, so a missing or wrong-kind asset is left out and renders its default.
 */
function conformBlockObject(
  value: unknown,
  schema: unknown,
  rootSchema: unknown,
): Record<string, unknown> {
  const stored = isObject(value) ? value : {};
  const fields = new Map(fieldsOf(schema).map((field) => [field.name, field]));
  const candidate: Record<string, unknown> = {};
  for (const field of fields.values()) {
    if (field.kind === "Repeater") continue;
    if (Object.hasOwn(stored, field.name)) {
      candidate[field.name] = normalizeFieldValue(stored[field.name], field.kind);
      continue;
    }
    const fallback = defaultOf(field, "block");
    if (fallback) candidate[field.name] = fallback.value;
  }
  // Most content already conforms: one check for the whole object, then field by field.
  const whole = Effect.runSyncExit(validateContent(candidate, schema, { rootSchema }));
  if (Exit.isSuccess(whole)) return candidate;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    const field = fields.get(key)!;
    if (blockValueHasKind(field, value, rootSchema)) {
      result[key] = value;
      continue;
    }
    const fallback = defaultOf(field, "block");
    if (fallback) result[key] = fallback.value;
  }
  return result;
}

/**
 * The fields of block or repeatable item content storing a value of the wrong kind, which
 * reading replaces with the default. Repeaters are stored as item rows: they hold no value here.
 */
export function wrongKindBlockFields(value: unknown, schema: unknown, rootSchema: unknown) {
  const stored = isObject(value) ? value : {};
  return fieldsOf(schema).flatMap((field) => {
    if (field.kind === "Repeater" || !Object.hasOwn(stored, field.name)) return [];
    const normalized = normalizeFieldValue(stored[field.name], field.kind);
    return blockValueHasKind(field, normalized, rootSchema) ? [] : [field.name];
  });
}

/** Settings conform like content; a definition without settings has none. */
function conformSettings(settings: unknown, schema: unknown, rootSchema: unknown) {
  if (!isObject(schema)) return null;
  return conformBlockObject(settings, schema, rootSchema);
}

export type BlockDefinitionSchemas = { contentSchema: unknown; settingsSchema?: unknown };

type ConformableBlock = { id: string; type: string; content: unknown; settings: unknown };
type ConformableItem = {
  id: string;
  blockId: string;
  parentItemId: string | null;
  fieldName: string;
  content: unknown;
  settings: unknown;
};

/**
 * Conforms blocks and their repeatable items to the block definitions in effect. A block
 * whose definition is gone keeps its place, with no content, settings or items: it renders
 * nothing. Items are left out when the repeater holding them, or their parent item, is gone.
 */
export function conformBlocks<B extends ConformableBlock, I extends ConformableItem>(
  definitions: ReadonlyMap<string, BlockDefinitionSchemas>,
  blocks: readonly B[],
  items: readonly I[],
): { blocks: B[]; items: I[] } {
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const itemsByBlock = Map.groupBy(items, (item) => item.blockId);
  const itemSchemasById = new Map(
    [...itemsByBlock].flatMap(([blockId, blockItems]) => {
      const block = blockById.get(blockId);
      const root = block ? definitions.get(block.type)?.contentSchema : undefined;
      return [...itemSchemas(root, blockItems)];
    }),
  );

  const conformedBlocks = blocks.map((block) => {
    const definition = definitions.get(block.type);
    if (!definition) return { ...block, content: {}, settings: null };
    const root = definition.contentSchema;
    return {
      ...block,
      content: conformBlockObject(block.content, root, root),
      settings: conformSettings(
        block.settings,
        definition.settingsSchema,
        definition.settingsSchema,
      ),
    };
  });
  const conformedItems = items.flatMap((item) => {
    const schemas = itemSchemasById.get(item.id);
    if (!schemas) return [];
    const block = blockById.get(item.blockId)!;
    const root = definitions.get(block.type)?.contentSchema;
    return [
      {
        ...item,
        content: conformBlockObject(item.content, schemas.content, root),
        settings: conformSettings(item.settings, schemas.settings, root),
      },
    ];
  });
  return { blocks: conformedBlocks, items: conformedItems };
}

/**
 * Conforms blocks and items to the block definitions of the scope they're read in: a
 * development draft's own, or Live's (ADR 0006, ADR 0007).
 */
export const conformBlocksIn = Effect.fn("conformBlocksIn")(function* <
  B extends ConformableBlock,
  I extends ConformableItem,
>(
  ctx: ServiceContext,
  scope: { projectId: number },
  draft: DraftScope,
  blocks: readonly B[],
  items: readonly I[],
) {
  const rows = yield* Effect.promise(() =>
    ctx.db
      .select({
        blockId: blockDefinitions.blockId,
        contentSchema: blockDefinitions.contentSchema,
        settingsSchema: blockDefinitions.settingsSchema,
      })
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, scope.projectId),
          definitionsIn(blockDefinitions, draft),
        ),
      ),
  );
  return conformBlocks(new Map(rows.map((row) => [row.blockId, row])), blocks, items);
});

const uuid = z.uuid();
function textOf(value: unknown): string | null {
  if (typeof value === "string") {
    return isLexicalState(value) ? lexicalStateToPlainText(value) : value;
  }
  if (isObject(value) && isObject(value.root)) return lexicalStateToPlainText(value);
  return null;
}

function textHasKind(field: Field, text: string) {
  const { minLength, maxLength, pattern } = field.schema;
  if (typeof minLength === "number" && text.length < minLength) return false;
  if (typeof maxLength === "number" && text.length > maxLength) return false;
  if (typeof pattern === "string" && !new RegExp(pattern).test(text)) return false;
  return true;
}

function listHasKind(field: Field, value: unknown[]) {
  const { minItems, maxItems } = field.schema;
  if (typeof minItems === "number" && value.length < minItems) return false;
  return value.length <= (typeof maxItems === "number" ? maxItems : 100);
}

/** Records store assets as `{ _fileId }`; a file that is gone reads as empty on resolve. */
function assetHasKind(value: unknown) {
  return assetFileId(value) !== undefined;
}

/** The shapes collection writes store for each field kind. */
function recordValueHasKind(field: Field, value: unknown): boolean {
  switch (field.kind) {
    case "String": {
      const text = textOf(value);
      return text !== null && textHasKind(field, text);
    }
    case "Embed":
      return typeof value === "string" && textHasKind(field, value);
    case "Enum":
      return typeof value === "string" && field.options.includes(value);
    case "Boolean":
      return typeof value === "boolean";
    case "Reference":
      return value === null || uuid.safeParse(value).success;
    case "ReferenceList":
      return (
        Array.isArray(value) &&
        listHasKind(field, value) &&
        new Set(value).size === value.length &&
        value.every((id) => uuid.safeParse(id).success)
      );
    case "Image":
    case "File":
      return value === null || assetHasKind(value);
    case "ImageList":
    case "FileList":
      return (
        Array.isArray(value) &&
        listHasKind(field, value) &&
        value.every((asset) => assetHasKind(asset))
      );
    default:
      return false;
  }
}

/** Conforms a collection record's content to its collection's content schema. */
export function conformRecordContent(
  contentSchema: unknown,
  content: unknown,
): Record<string, unknown> {
  const stored = isObject(content) ? content : {};
  const result: Record<string, unknown> = {};
  for (const field of fieldsOf(contentSchema)) {
    const { name } = field;
    const holds = Object.hasOwn(stored, name) && recordValueHasKind(field, stored[name]);
    result[name] = holds ? stored[name] : defaultOf(field, "record").value;
  }
  return result;
}

/**
 * The fields of a record's content storing a value of the wrong kind, which reading replaces
 * with the default.
 */
export function wrongKindRecordFields(contentSchema: unknown, content: unknown) {
  const stored = isObject(content) ? content : {};
  return fieldsOf(contentSchema).flatMap((field) =>
    Object.hasOwn(stored, field.name) && !recordValueHasKind(field, stored[field.name])
      ? [field.name]
      : [],
  );
}
