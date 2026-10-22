/**
 * Structured Data the API evaluates from block and repeatable item templates, for the runtime to
 * put in a page's graph. Only the runtime knows the website's address, so where a node needs an
 * absolute URL to a page of the website, the API leaves a marker the runtime resolves.
 */

/** A JSON value of a node the API evaluated, which may hold markers. */
export type StructuredDataValue =
  | string
  | number
  | boolean
  | null
  | StructuredDataValue[]
  | { [key: string]: StructuredDataValue };

/** A node the API evaluated from a template, before the runtime resolves its markers. */
export type EvaluatedNode = { [key: string]: StructuredDataValue };

/**
 * A page of the website, by its path in a locale, whose absolute URL the runtime fills in. The
 * path is locale-relative, as pages store it; without `locale`, it's the default locale's.
 */
export type PageUrlMarker = { "@camox": "pageUrl"; path: string; locale?: string };

/**
 * A link to a collection record's node, as templates and record pages' layouts leave it. Only the
 * runtime knows the website's address, which a record's `@id` is built from, so the link names
 * the record by its id, and the runtime gives it the record's `@id` in the page's locale.
 */
export type RecordLink = { "@id": `camox:record:${string}` };

const RECORD_LINK_PREFIX = "camox:record:";

/** A link to the node of the record with id `id`. */
export function recordLink(id: string): RecordLink {
  return { "@id": `${RECORD_LINK_PREFIX}${id}` };
}

/** The id of the record a value links, when it is a record link. */
export function linkedRecordId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const id = (value as { "@id"?: unknown })["@id"];
  if (typeof id !== "string" || !id.startsWith(RECORD_LINK_PREFIX)) return undefined;
  return id.slice(RECORD_LINK_PREFIX.length);
}

/**
 * The nodes of the records a read's content references, from their collections' templates, and
 * of the records those link in turn. Their `@id`s and links are record links.
 */
export type RecordStructuredData = {
  /** Each record's node, by record id. */
  nodes: Record<string, EvaluatedNode>;
  /**
   * The records with nodes that the content references itself, in the order found: the page's
   * `mentions`, unless a node places them.
   */
  referenced: string[];
};

/** The Article types, whose name is their `headline`. */
export const ARTICLE_TYPES = [
  "Article",
  "BlogPosting",
  "NewsArticle",
  "TechArticle",
  "ScholarlyArticle",
  "Report",
  "SocialMediaPosting",
] as const;

/** Whether a value is a marker for a page's URL. */
export function isPageUrlMarker(value: unknown): value is PageUrlMarker {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { "@camox"?: unknown })["@camox"] === "pageUrl" &&
    typeof (value as { path?: unknown }).path === "string"
  );
}
