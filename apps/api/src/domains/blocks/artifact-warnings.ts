import { artifactSourceTitle, UNTITLED_ARTIFACT } from "@camox/api-contract";

/**
 * Warnings for the artifact sources a content write sets without a non-empty `<title>`. Such
 * writes succeed, but the artifact gets no accessible name or Markdown Representation.
 */
export function artifactWarnings(
  schema: { properties?: Record<string, any> } | null | undefined,
  content: unknown,
  path = "content",
): string[] {
  const properties = schema?.properties;
  if (!properties || !content || typeof content !== "object" || Array.isArray(content)) return [];
  const warnings: string[] = [];
  for (const [key, value] of Object.entries(content as Record<string, unknown>)) {
    const field = properties[key];
    const fieldPath = `${path}.${key}`;
    if (field?.fieldType === "Artifact") {
      if (typeof value !== "string" || value.trim() === "") continue;
      if (artifactSourceTitle(value)) continue;
      warnings.push(
        `Artifact source at ${fieldPath} has no non-empty <title>, so it is called ` +
          `"${UNTITLED_ARTIFACT}". Add a meaningful <title>: it names the artifact for screen ` +
          "readers and is its Markdown Representation.",
      );
      continue;
    }
    if (field?.fieldType !== "Repeater" || !Array.isArray(value)) continue;
    value.forEach((item, index) => {
      warnings.push(...artifactWarnings(field.items, item, `${fieldPath}[${index}]`));
    });
  }
  return warnings;
}

/** A write result with its warnings, when there are any. */
export function withWarnings<T extends object>(
  result: T,
  warnings: string[],
): T & { warnings?: string[] } {
  if (warnings.length === 0) return result;
  return { ...result, warnings };
}
