import type { Collection } from "./createCollection";
import type { RecordPageValues } from "./layoutContext";
import { resolveToMarkdown } from "./lib/contentType";
import { isLexicalState, lexicalStateToPlainText } from "./lib/lexicalState";
import type { LoadedRecord } from "./requestContext";

/**
 * The value when it names a collection record (a `collection-item` loader result or route
 * target), otherwise undefined.
 */
export function asCollectionItem<T extends { kind?: unknown }>(
  value: T | null | undefined,
): (T & { kind: "collection-item" }) | undefined {
  if (value?.kind !== "collection-item") return undefined;
  return value as T & { kind: "collection-item" };
}

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

/** The record a record page renders, as its layout's context names it. */
export function recordPageValues(collection: Collection, record: LoadedRecord): RecordPageValues {
  return {
    title: record.title ?? "",
    description: record.description ?? undefined,
    content: recordPlainText(collection, record.content),
  };
}

/**
 * A record's title and description: its collection's templates filled with its fields' plain
 * text, as the API fills them. For records edited here, before the API names them again.
 */
export function recordText(
  collection: Pick<Collection, "_internal"> | undefined,
  content: Record<string, unknown>,
): { title: string; description: string | null } {
  const fill = (template: string) =>
    template
      .replace(/\{\{([^}]*)\}\}/g, (_token, name: string) => fieldPlainText(content[name]))
      .trim();
  const toDescription = collection?._internal.toDescription;
  return {
    title: collection ? fill(collection._internal.toTitle) : "",
    description: (toDescription && fill(toDescription)) || null,
  };
}

/**
 * The first field a collection's title template names, such as `firstName` in
 * `{{firstName}} {{lastName}}`: where a new record's name goes.
 */
export function titleField(toTitle: string): string | undefined {
  return /\{\{([^}]*)\}\}/.exec(toTitle)?.[1];
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
