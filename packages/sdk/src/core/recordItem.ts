import type { Collection } from "./createCollection";
import { resolveToMarkdown } from "./lib/contentType";
import { isLexicalState, lexicalStateToPlainText } from "./lib/lexicalState";

/** A record page's String fields as plain text, as its meta callbacks get them. */
export function recordPlainText(
  collection: Collection,
  content: Record<string, unknown>,
): Record<string, string> {
  const properties = collection._internal.contentSchema.properties as Record<
    string,
    { fieldType?: string }
  >;
  const text: Record<string, string> = {};
  for (const [name, field] of Object.entries(properties)) {
    if (field.fieldType === "String") text[name] = fieldPlainText(content[name]);
  }
  return text;
}

/** A String field's text, whether it is stored as plain text or rich-text state. */
export function fieldPlainText(value: unknown): string {
  if (typeof value !== "string" && !isLexicalState(value)) return "";
  return lexicalStateToPlainText(value as string | Record<string, unknown>);
}

/**
 * Runs a record layout's `toMarkdown` with `item` as the reference-list Markdown builder. Its
 * field tokens are left for the API to fill with the live record.
 */
export function recordMarkdownTemplate(
  collection: Collection,
  toMarkdown: (item: unknown) => readonly string[],
): string[] {
  return resolveToMarkdown(
    (item) => toMarkdown(item),
    undefined,
    "item",
    collection._internal.contentSchema.properties,
  );
}
