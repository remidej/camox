/**
 * Recursively rewrites `{ "_fileId": <id> }` markers embedded in a JSON tree,
 * replacing each `id` via the provided map. Marker objects whose source id is
 * not present in the map are preserved verbatim (no remap).
 *
 * Shape mirrors `cleanFileReferences` / `containsFileRef` in
 * `domains/files/service.ts`, but instead of deleting matching entries this
 * translates them — used during environment replication to remap a source
 * env's file ids onto the freshly-inserted target env file ids.
 *
 * The recursion preserves arrays, plain objects, and primitives; non-object
 * values pass through untouched.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export function remapFileReferences(value: JsonValue, filesMap: Map<string, string>): JsonValue {
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((entry) => remapFileReferences(entry, filesMap));
  }

  // File-reference marker: rewrite the id if we have a mapping, otherwise keep
  // the marker as-is (caller decides whether dangling refs should be cleaned
  // up afterwards).
  if ("_fileId" in value && typeof value._fileId === "string") {
    const remapped = filesMap.get(value._fileId);
    if (remapped === undefined) return value;
    return { ...value, _fileId: remapped };
  }

  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = remapFileReferences(v, filesMap);
  }
  return out;
}
