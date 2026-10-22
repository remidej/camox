import {
  recordLink,
  type RecordLink,
  recordText as fillRecordText,
  type RecordText,
  templateFields,
} from "@camox/api-contract";

import type { Collection } from "./createCollection";
import type { PublishTimes, RecordPageValues } from "./layoutContext";
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

/**
 * A record's references as links to their records' nodes: one for a reference, which is absent
 * when it resolves to nothing, and a list for a reference list.
 */
function recordLinks(
  collection: Collection,
  references: LoadedRecord["references"],
): Record<string, RecordLink | RecordLink[]> {
  const properties = collection._internal.contentSchema.properties as Record<
    string,
    { fieldType?: string }
  >;
  const links: Record<string, RecordLink | RecordLink[]> = {};
  for (const [name, field] of Object.entries(properties)) {
    const resolved = references?.[name];
    if (field.fieldType === "ReferenceList")
      links[name] = (Array.isArray(resolved) ? resolved : []).map(({ id }) => recordLink(id));
    if (field.fieldType === "Reference" && resolved && !Array.isArray(resolved))
      links[name] = recordLink(resolved.id);
  }
  return links;
}

/** The titles of the records a record references, by record id. */
function referencedTitles(references: LoadedRecord["references"]): Record<string, string> {
  return Object.fromEntries(
    Object.values(references ?? {})
      .flatMap((value) => [value ?? []].flat())
      .map((record) => [record.id, record.title]),
  );
}

/**
 * The record a record page renders, as its layout's context names it, from the record a loader
 * found and when it was published to Live.
 */
export function recordPageValues(
  collection: Collection,
  { data: record, published }: { data: LoadedRecord; published?: PublishTimes },
): RecordPageValues {
  return {
    title: record.title ?? "",
    description: record.description ?? undefined,
    content: {
      ...recordLinks(collection, record.references),
      ...recordPlainText(collection, record.content),
    },
    titles: referencedTitles(record.references),
    ...(published && { published }),
  };
}

/**
 * A record's title and description: its collection's templates filled with its fields' plain
 * text, as the API fills them. For records edited here, before the API names them again.
 */
export function recordText(
  collection: Pick<Collection, "_internal"> | undefined,
  content: Record<string, unknown>,
): RecordText {
  if (!collection) return { title: "", description: null };
  return fillRecordText(collection._internal, (name) => fieldPlainText(content[name]));
}

/**
 * The first field a collection's title template names, such as `firstName` in
 * `{{firstName}} {{lastName}}`: where a new record's name goes.
 */
export function titleField(toTitle: string): string | undefined {
  return templateFields(toTitle)[0];
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
    ({ content }) => toMarkdown(content),
    undefined,
    "item",
    collection._internal.contentSchema.properties,
  );
}
