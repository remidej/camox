import { Effect } from "effect";

import { InvalidInputError } from "../../lib/errors";
import { validateReferenceSchema } from "../collections/references";
import { initializeBlockContent } from "./initialize-content";
import {
  normalizeBlockContent,
  sanitizeItemContent,
  validateItemSeeds,
  type BlockItemSeed,
  type FieldSchema,
} from "./normalize-content";
import { validateContent } from "./validate-content";

/** Reconstruct the authored JSON for validation; persistence still owns separate item rows. */
export const contentWithSeeds = Effect.fn("contentWithSeeds")(function* (
  content: Record<string, unknown>,
  seeds: BlockItemSeed[],
  schema: FieldSchema | null | undefined,
  parentTempId: string | null = null,
): Effect.fn.Return<Record<string, unknown>, InvalidInputError> {
  const result = structuredClone(content);
  for (const [name, field] of Object.entries(schema?.properties ?? {})) {
    if (field.fieldType === "Repeater") result[name] = [];
  }
  for (const seed of seeds) {
    if (seed.parentTempId !== parentTempId) continue;
    const items = (result[seed.fieldName] ??= []) as unknown[];
    if (!Array.isArray(items)) {
      return yield* new InvalidInputError({
        message: `Conflicting content and item seeds for "${seed.fieldName}"`,
        data: { field: seed.fieldName },
      });
    }
    items.push(
      yield* contentWithSeeds(
        seed.content as Record<string, unknown>,
        seeds,
        schema?.properties?.[seed.fieldName]?.items,
        seed.tempId,
      ),
    );
  }
  return result;
});

/** Prepare a complete new block bundle before any database mutations. */
export const prepareBlockContent = Effect.fn("prepareBlockContent")(function* (
  rawContent: unknown,
  rawSettings: unknown,
  explicitSeeds: BlockItemSeed[] | undefined,
  contentSchema: unknown,
  settingsSchema: unknown,
  context: { contentSchema?: unknown; settingsSchema?: unknown } = {},
) {
  const rootSchema = context.contentSchema ?? contentSchema;
  yield* validateReferenceSchema(rootSchema);
  yield* validateReferenceSchema(context.settingsSchema ?? settingsSchema, false);
  // Shape checks precede defaulting, which otherwise turns invalid roots into {}.
  if (rawContent !== undefined) yield* validateContent(rawContent, null);
  if (rawSettings != null) yield* validateContent(rawSettings, null, { path: "settings" });
  const schema = contentSchema as FieldSchema | null | undefined;
  const initial = initializeBlockContent(rawContent, schema, explicitSeeds === undefined);
  const normalized = yield* normalizeBlockContent(initial, schema, rootSchema);
  const seeds = [...(explicitSeeds ?? []), ...normalized.seeds].map((seed) => ({ ...seed }));
  yield* validateItemSeeds(seeds, schema?.properties, "repeatableItems", rootSchema);

  const schemas = new Map<string, FieldSchema | undefined>();
  for (const seed of seeds) {
    const parent = seed.parentTempId === null ? schema : schemas.get(seed.parentTempId);
    const field = parent?.properties?.[seed.fieldName];
    schemas.set(seed.tempId, field?.items);
    seed.content = yield* sanitizeItemContent(
      initializeBlockContent(seed.content, field?.items, false),
      field?.items?.properties,
      rootSchema,
    );
    seed.settings = yield* prepareSettings(seed.settings, field?.itemSettingsSchema, rootSchema);
  }

  const bundle = yield* contentWithSeeds(normalized.content, seeds, schema);
  yield* validateContent(bundle, schema, { partial: false, rootSchema });
  const settings = yield* prepareSettings(
    rawSettings,
    settingsSchema,
    context.settingsSchema ?? settingsSchema,
  );
  // `bundle` inlines the seeded items, for checks that span the block and its items.
  return { content: normalized.content, settings, seeds, bundle };
});

export const prepareSettings = Effect.fn("prepareSettings")(function* (
  raw: unknown,
  schema: unknown,
  rootSchema: unknown = schema,
): Effect.fn.Return<Record<string, unknown> | null, InvalidInputError> {
  if (raw == null && schema == null) return null;
  if (raw != null) yield* validateContent(raw, null, { path: "settings" });
  const settings = initializeBlockContent(raw ?? undefined, schema);
  yield* validateContent(settings, schema, { partial: false, path: "settings", rootSchema });
  return settings;
});

/** Existing items carry patches; new inline items receive their declared defaults. */
export const prepareContentPatch = Effect.fn("prepareContentPatch")(function* (
  raw: unknown,
  schema: FieldSchema | null | undefined,
): Effect.fn.Return<Record<string, unknown>, InvalidInputError> {
  yield* validateContent(raw, null);
  const patch = { ...(raw as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    const field = schema?.properties?.[key];
    if (field?.fieldType !== "Repeater" || !Array.isArray(value)) continue;
    patch[key] = yield* Effect.forEach(value, (item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return Effect.succeed(item);
      if ("_itemId" in item) return prepareContentPatch(item, field.items);
      return Effect.succeed(initializeBlockContent(item, field.items));
    });
  }
  return patch;
});
