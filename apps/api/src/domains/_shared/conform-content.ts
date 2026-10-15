import { eq } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { z } from "zod";

import { isLexicalState, lexicalStateToPlainText } from "../../lib/lexical-state";
import { blockDefinitions } from "../block-definitions/schema";
import { normalizeFieldValue } from "../blocks/asset-value";
import { validateContent } from "../blocks/validate-content";
import { assetFileId } from "../collections/record-files";
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

type Field = {
  [key: string]: unknown;
  fieldType?: string;
  default?: unknown;
  enum?: unknown[];
  items?: unknown;
  itemSettingsSchema?: unknown;
};

const assetTypes = new Set(["Image", "File", "ImageList", "FileList"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function propertiesOf(schema: unknown): Record<string, Field> {
  if (!isObject(schema) || !isObject(schema.properties)) return {};
  return schema.properties as Record<string, Field>;
}

/** Whether a write would accept this value for the field: the same check, applied on read. */
function blockValueHasKind(field: Field, value: unknown, rootSchema: unknown) {
  const exit = Effect.runSyncExit(
    validateContent({ value }, { type: "object", properties: { value: field } }, { rootSchema }),
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
  const properties = propertiesOf(schema);
  const candidate: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(properties)) {
    if (field.fieldType === "Repeater") continue;
    if (Object.hasOwn(stored, key)) {
      candidate[key] = normalizeFieldValue(stored[key], field.fieldType);
      continue;
    }
    if (assetTypes.has(field.fieldType ?? "") || !Object.hasOwn(field, "default")) continue;
    candidate[key] = structuredClone(field.default);
  }
  // Most content already conforms: one check for the whole object, then field by field.
  const whole = Effect.runSyncExit(validateContent(candidate, schema, { rootSchema }));
  if (Exit.isSuccess(whole)) return candidate;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    const field = properties[key];
    if (blockValueHasKind(field, value, rootSchema)) {
      result[key] = value;
      continue;
    }
    if (assetTypes.has(field.fieldType ?? "") || !Object.hasOwn(field, "default")) continue;
    result[key] = structuredClone(field.default);
  }
  return result;
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
  const itemById = new Map(items.map((item) => [item.id, item]));
  // An item's repeater field, found by walking up to its block; null when the path is gone.
  const repeaterOf = new Map<string, Field | null>();
  const resolve = (item: I, seen: Set<string>): Field | null => {
    const known = repeaterOf.get(item.id);
    if (known !== undefined) return known;
    if (seen.has(item.id)) return null;
    seen.add(item.id);
    let container: unknown;
    if (item.parentItemId === null) {
      const block = blockById.get(item.blockId);
      container = block ? definitions.get(block.type)?.contentSchema : undefined;
    } else {
      const parent = itemById.get(item.parentItemId);
      container = parent ? resolve(parent, seen)?.items : undefined;
    }
    const field = propertiesOf(container)[item.fieldName];
    const repeater = field?.fieldType === "Repeater" ? field : null;
    repeaterOf.set(item.id, repeater);
    return repeater;
  };

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
    const repeater = resolve(item, new Set());
    if (!repeater) return [];
    const block = blockById.get(item.blockId)!;
    const root = definitions.get(block.type)?.contentSchema;
    return [
      {
        ...item,
        content: conformBlockObject(item.content, repeater.items, root),
        settings: conformSettings(item.settings, repeater.itemSettingsSchema, root),
      },
    ];
  });
  return { blocks: conformedBlocks, items: conformedItems };
}

/** Conforms blocks and items to the block definitions of the scope they're read in. */
export const conformBlocksIn = Effect.fn("conformBlocksIn")(function* <
  B extends ConformableBlock,
  I extends ConformableItem,
>(
  ctx: ServiceContext,
  scope: { environmentId: number },
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
      .where(eq(blockDefinitions.environmentId, scope.environmentId)),
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
  if (typeof field.minLength === "number" && text.length < field.minLength) return false;
  if (typeof field.maxLength === "number" && text.length > field.maxLength) return false;
  if (typeof field.pattern === "string" && !new RegExp(field.pattern).test(text)) return false;
  return true;
}

function listHasKind(field: Field, value: unknown[]) {
  if (typeof field.minItems === "number" && value.length < field.minItems) return false;
  return value.length <= (typeof field.maxItems === "number" ? field.maxItems : 100);
}

/** Records store assets as `{ _fileId }`; a file that is gone reads as empty on resolve. */
function assetHasKind(value: unknown) {
  return assetFileId(value) !== undefined;
}

/** The shapes collection writes store for each field kind. */
function recordValueHasKind(field: Field, value: unknown): boolean {
  switch (field.fieldType) {
    case "String": {
      const text = textOf(value);
      return text !== null && textHasKind(field, text);
    }
    case "Embed":
      return typeof value === "string" && textHasKind(field, value);
    case "Enum":
      return typeof value === "string" && (field.enum ?? []).includes(value);
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

/** A collection field's value when it has no default. */
function emptyRecordValue(field: Field): unknown {
  switch (field.fieldType) {
    case "Boolean":
      return false;
    case "Enum":
      return field.enum?.[0] ?? "";
    case "Image":
    case "File":
    case "Reference":
      return null;
    case "ImageList":
    case "FileList":
    case "ReferenceList":
      return [];
    default:
      return "";
  }
}

/** Conforms a collection record's content to its collection's content schema. */
export function conformRecordContent(
  contentSchema: unknown,
  content: unknown,
): Record<string, unknown> {
  const stored = isObject(content) ? content : {};
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(propertiesOf(contentSchema))) {
    if (Object.hasOwn(stored, key) && recordValueHasKind(field, stored[key])) {
      result[key] = stored[key];
      continue;
    }
    // Asset defaults are preview placeholders, never authored record content.
    const hasDefault = Object.hasOwn(field, "default") && !assetTypes.has(field.fieldType ?? "");
    result[key] = hasDefault ? structuredClone(field.default) : emptyRecordValue(field);
  }
  return result;
}
