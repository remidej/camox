/**
 * Deterministic JSON serialization with sorted object keys.
 *
 * Used to compare JSON columns (e.g. `block_definitions.contentSchema`) when a
 * definition sync decides whether a definition changed. Drizzle
 * hands these to us as already-parsed objects, but SQLite gives no guarantee
 * about key order, so direct `JSON.stringify` would produce false mismatches.
 *
 * Behavior matches the structural semantics of `JSON.stringify` (returns
 * `undefined` for `undefined` / function values; throws on cycles via recursion
 * depth), except object keys are emitted in sorted order at every level.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const serialized = stableStringify(obj[key]);
    if (serialized === undefined) continue; // matches JSON.stringify: skip undefined values
    parts.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${parts.join(",")}}`;
}
