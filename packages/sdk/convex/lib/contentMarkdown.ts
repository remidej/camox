import { isLexicalState, lexicalStateToMarkdown } from "../../src/core/lib/lexicalState";

export function contentToMarkdown(
  toMarkdown: readonly string[],
  schemaProperties: Record<string, any>,
  content: Record<string, unknown>,
): string {
  const parts: string[] = [];

  for (const line of toMarkdown) {
    const resolved = resolveLine(line, schemaProperties, content);
    if (resolved !== null) parts.push(resolved);
  }

  return parts.join("\n\n");
}

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

function resolveLine(
  line: string,
  schemaProperties: Record<string, any>,
  content: Record<string, unknown>,
): string | null {
  // Find all placeholders in the line
  const placeholders = [...line.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
  if (placeholders.length === 0) return line;

  // Check if ALL placeholders resolve to empty
  const resolvedValues = placeholders.map((key) =>
    resolveField(schemaProperties[key], content[key]),
  );
  if (resolvedValues.every((v) => !v)) return null;

  // Replace placeholders with resolved values
  return line.replace(PLACEHOLDER_RE, (_match, key: string) => {
    return resolveField(schemaProperties[key], content[key]) ?? "";
  });
}

function resolveField(schema: any, value: unknown): string | undefined {
  if (value == null) return undefined;
  const fieldType: string | undefined = schema?.fieldType;

  if (fieldType === "String") {
    const text = String(value);
    if (!text) return undefined;
    if (isLexicalState(text)) return lexicalStateToMarkdown(text) || undefined;
    return text;
  }

  if (fieldType === "Link") {
    const link = value as Record<string, unknown>;
    const text = link.text ?? "";
    const href = link.href ?? link.pageId ?? "";
    if (!text && !href) return undefined;
    return `[${text}](${href})`;
  }

  if (fieldType === "Image") {
    const img = value as Record<string, unknown>;
    const alt = img.alt ?? "";
    const filename = img.filename ?? "";
    return `![${alt}](${filename})`;
  }

  if (fieldType === "File") {
    const file = value as Record<string, unknown>;
    const filename = file.filename ?? "";
    const url = file.url ?? "";
    return `[${filename}](${url})`;
  }

  if (fieldType === "Embed") {
    const url = String(value);
    return url || undefined;
  }

  if (fieldType === "RepeatableObject") {
    if (!Array.isArray(value)) return undefined;
    const itemSchema = schema?.items?.properties;
    if (!itemSchema) return undefined;

    const itemToMarkdown: readonly string[] | undefined = schema?.toMarkdown;

    const itemParts: string[] = [];
    for (const item of value) {
      const itemContent =
        item && typeof item === "object" && "content" in item
          ? (item as any).content
          : item;
      if (!itemContent || typeof itemContent !== "object") continue;

      let md: string;
      if (itemToMarkdown) {
        md = contentToMarkdown(itemToMarkdown, itemSchema, itemContent as Record<string, unknown>);
      } else {
        // Fallback: render each field as a line
        const fieldParts: string[] = [];
        for (const key of Object.keys(itemSchema)) {
          const resolved = resolveField(itemSchema[key], (itemContent as Record<string, unknown>)[key]);
          if (resolved) fieldParts.push(resolved);
        }
        md = fieldParts.join(" — ");
      }
      if (md) itemParts.push(md);
    }
    return itemParts.length > 0 ? itemParts.join("\n\n") : undefined;
  }

  if (fieldType === "Boolean" || fieldType === "Enum") {
    return String(value);
  }

  return undefined;
}
