import { defaultOf, fieldsOf } from "../_shared/fields";

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

  for (const field of fieldsOf(schema)) {
    const { name } = field;
    if (field.kind === "Repeater") {
      if (!Object.hasOwn(result, name) && seedRepeaters) {
        result[name] = Array.from({ length: field.defaultItems }, () => ({}));
      }
      if (Array.isArray(result[name])) {
        result[name] = result[name].map((item: unknown) => {
          // Leave invalid values intact so normalization still rejects them.
          if (!item || typeof item !== "object" || Array.isArray(item)) return item;
          return initializeBlockContent(item, field.itemContentSchema, seedRepeaters);
        });
      }
      continue;
    }
    if (Object.hasOwn(result, name)) continue;
    const fallback = defaultOf(field, "block");
    if (fallback) result[name] = fallback.value;
  }
  return result;
}
