import { ORPCError } from "@orpc/server";

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
export function contentWithSeeds(
  content: Record<string, unknown>,
  seeds: BlockItemSeed[],
  schema: FieldSchema | null | undefined,
  parentTempId: string | null = null,
): Record<string, unknown> {
  const result = structuredClone(content);
  for (const [name, field] of Object.entries(schema?.properties ?? {})) {
    if (field.fieldType === "Repeater") result[name] = [];
  }
  for (const seed of seeds) {
    if (seed.parentTempId !== parentTempId) continue;
    const items = (result[seed.fieldName] ??= []) as unknown[];
    if (!Array.isArray(items)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Conflicting content and item seeds for "${seed.fieldName}"`,
        data: { field: seed.fieldName },
      });
    }
    items.push(
      contentWithSeeds(
        seed.content as Record<string, unknown>,
        seeds,
        schema?.properties?.[seed.fieldName]?.items,
        seed.tempId,
      ),
    );
  }
  return result;
}

/** Prepare a complete new block bundle before any database mutations. */
export function prepareBlockContent(
  rawContent: unknown,
  rawSettings: unknown,
  explicitSeeds: BlockItemSeed[] | undefined,
  contentSchema: unknown,
  settingsSchema: unknown,
  context: { contentSchema?: unknown; settingsSchema?: unknown } = {},
) {
  const rootSchema = context.contentSchema ?? contentSchema;
  validateReferenceSchema(rootSchema);
  validateReferenceSchema(context.settingsSchema ?? settingsSchema, false);
  // Shape checks precede defaulting, which otherwise turns invalid roots into {}.
  if (rawContent !== undefined) validateContent(rawContent, null);
  if (rawSettings != null) validateContent(rawSettings, null, { path: "settings" });
  const schema = contentSchema as FieldSchema | null | undefined;
  const initial = initializeBlockContent(rawContent, schema, explicitSeeds === undefined);
  const normalized = normalizeBlockContent(initial, schema, rootSchema);
  const seeds = [...(explicitSeeds ?? []), ...normalized.seeds].map((seed) => ({ ...seed }));
  validateItemSeeds(seeds, schema?.properties, "repeatableItems", rootSchema);

  const schemas = new Map<string, FieldSchema | undefined>();
  for (const seed of seeds) {
    const parent = seed.parentTempId === null ? schema : schemas.get(seed.parentTempId);
    const field = parent?.properties?.[seed.fieldName];
    schemas.set(seed.tempId, field?.items);
    seed.content = sanitizeItemContent(
      initializeBlockContent(seed.content, field?.items, false),
      field?.items?.properties,
      rootSchema,
    );
    seed.settings = prepareSettings(seed.settings, field?.itemSettingsSchema, rootSchema);
  }

  validateContent(contentWithSeeds(normalized.content, seeds, schema), schema, {
    partial: false,
    rootSchema,
  });
  const settings = prepareSettings(
    rawSettings,
    settingsSchema,
    context.settingsSchema ?? settingsSchema,
  );
  return { content: normalized.content, settings, seeds };
}

export function prepareSettings(
  raw: unknown,
  schema: unknown,
  rootSchema: unknown = schema,
): Record<string, unknown> | null {
  if (raw == null && schema == null) return null;
  if (raw != null) validateContent(raw, null, { path: "settings" });
  const settings = initializeBlockContent(raw ?? undefined, schema);
  validateContent(settings, schema, { partial: false, path: "settings", rootSchema });
  return settings;
}

/** Existing items carry patches; new inline items receive their declared defaults. */
export function prepareContentPatch(raw: unknown, schema: FieldSchema | null | undefined) {
  validateContent(raw, null);
  const patch = { ...(raw as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    const field = schema?.properties?.[key];
    if (field?.fieldType !== "Repeater" || !Array.isArray(value)) continue;
    patch[key] = value.map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      if ("_itemId" in item) return prepareContentPatch(item, field.items);
      return initializeBlockContent(item, field.items);
    });
  }
  return patch;
}
