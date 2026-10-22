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

/** Whether a value is a marker for a page's URL. */
export function isPageUrlMarker(value: unknown): value is PageUrlMarker {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { "@camox"?: unknown })["@camox"] === "pageUrl" &&
    typeof (value as { path?: unknown }).path === "string"
  );
}
