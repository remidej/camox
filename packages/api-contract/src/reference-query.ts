/**
 * Rules for query-backed reference lists, shared by the SDK (builders) and the API (definition
 * sync), so both accept and reject the same queries.
 */

/** The most records a query-backed list resolves to, and its default `limit`. */
export const QUERY_LIMIT_CAP = 100;

/** Record metadata a query can order by. Collections cannot name fields after them. */
export type SystemOrderKey = "createdAt" | "publishedAt";
export const SYSTEM_ORDER_KEYS: readonly SystemOrderKey[] = ["createdAt", "publishedAt"];

export function isSystemOrderKey(key: string): key is SystemOrderKey {
  return (SYSTEM_ORDER_KEYS as readonly string[]).includes(key);
}

/** Whether a reference list field is query-backed: code defines its records, nothing is stored. */
export function isQueryBacked(field: object | null | undefined) {
  return !!field && (field as { query?: unknown }).query !== undefined;
}

/**
 * Why a query is invalid, if it is. `fieldTypeOf` gives the collection field type an ordering
 * key names; keys must name a `String` field or system metadata.
 */
export function referenceQueryProblem(
  query: unknown,
  fieldTypeOf: (key: string) => unknown,
): string | undefined {
  if (!query || typeof query !== "object" || Array.isArray(query)) return "query must be an object";
  const { orderBy, limit, ...rest } = query as Record<string, unknown>;
  if (Object.keys(rest).length) return "query only supports orderBy and limit";
  const validLimit =
    typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= QUERY_LIMIT_CAP;
  if (limit !== undefined && !validLimit) {
    return `limit must be an integer from 1 to ${QUERY_LIMIT_CAP}`;
  }
  if (orderBy === undefined) return;
  const entries =
    orderBy && typeof orderBy === "object" && !Array.isArray(orderBy)
      ? Object.entries(orderBy)
      : [];
  if (entries.length !== 1) return "orderBy takes a single key";
  const [[key, direction]] = entries;
  if (direction !== "asc" && direction !== "desc") return 'order must be "asc" or "desc"';
  if (isSystemOrderKey(key)) return;
  if (fieldTypeOf(key) !== "String") return `cannot order by "${key}"`;
}
