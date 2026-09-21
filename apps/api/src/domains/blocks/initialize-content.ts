type FieldSchema = {
  fieldType?: string;
  default?: unknown;
  defaultItems?: number;
  minItems?: number;
  items?: ContentSchema;
};
type ContentSchema = { properties?: Record<string, FieldSchema> };

/**
 * Fill omitted fields at creation time, without replacing explicit values.
 * Asset placeholders are render-only. Repeaters become inline objects for the
 * normalizer to turn into rows, unless the caller supplies its own seed bundle.
 */
export function initializeBlockContent(
  content: unknown,
  schema: unknown,
  seedRepeaters = true,
): Record<string, unknown> {
  const result: Record<string, unknown> =
    content && typeof content === "object" && !Array.isArray(content) ? { ...content } : {};
  const properties = (schema as ContentSchema | null)?.properties ?? {};

  for (const [key, field] of Object.entries(properties)) {
    if (field.fieldType === "Repeater") {
      if (!Object.hasOwn(result, key) && seedRepeaters) {
        result[key] = Array.from({ length: field.defaultItems ?? field.minItems ?? 0 }, () => ({}));
      }
      if (Array.isArray(result[key])) {
        result[key] = result[key].map((item: unknown) => {
          // Leave invalid values intact so normalization still rejects them.
          if (!item || typeof item !== "object" || Array.isArray(item)) return item;
          return initializeBlockContent(item, field.items, seedRepeaters);
        });
      }
      continue;
    }
    if (["Image", "File", "ImageList", "FileList"].includes(field.fieldType ?? "")) continue;
    if (Object.hasOwn(result, key) || !Object.hasOwn(field, "default")) continue;
    result[key] = structuredClone(field.default);
  }
  return result;
}
