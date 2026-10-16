import { PAGE_TEXT_LINK_PREFIX } from "@camox/api-contract/ids";

/** The new id of each old integer id that comes along, by kind. */
export type IdMaps = {
  file: Map<number, string>;
  page: Map<number, string>;
  item: Map<number, string>;
};

export type IdKind = keyof IdMaps;

const TEXT_LINK = new RegExp(`${PAGE_TEXT_LINK_PREFIX}(\\d+)`, "g");

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A marker of an entity by its id alone: `{ _fileId }` or `{ _itemId }`. */
function markerKind(value: Record<string, unknown>): "file" | "item" | null {
  if ("_fileId" in value) return "file";
  if ("_itemId" in value) return "item";
  return null;
}

/**
 * Rewrites the ids inside content to their new ids: file and item markers, page link fields
 * (`{ type: "page", pageId }`) and page text links (`camox:page:<id>`), in any string. An id that
 * points at nothing is stored empty, as it rendered: a marker becomes `null` (or leaves its
 * list), a page link's id becomes `""`, a text link keeps only its prefix. Each one is reported.
 */
export function rewriteContentIds(
  value: unknown,
  maps: IdMaps,
  onDangling: (kind: IdKind, id: number) => void,
): unknown {
  const lookup = (kind: IdKind, id: unknown) => {
    const found = maps[kind].get(Number(id));
    if (found === undefined) onDangling(kind, Number(id));
    return found;
  };

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      return node.replace(
        TEXT_LINK,
        (_, id: string) => PAGE_TEXT_LINK_PREFIX + (lookup("page", id) ?? ""),
      );
    }
    if (Array.isArray(node)) {
      return node.map(walk).filter((entry, index) => entry !== null || node[index] === null);
    }
    if (!isObject(node)) return node;

    const marker = markerKind(node);
    if (marker) {
      const key = marker === "file" ? "_fileId" : "_itemId";
      const id = lookup(marker, node[key]);
      return id === undefined ? null : { ...node, [key]: id };
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(node)) out[key] = walk(entry);
    if (node.type === "page" && /^\d+$/.test(String(node.pageId))) {
      out.pageId = lookup("page", node.pageId) ?? "";
    }
    return out;
  };

  return walk(value);
}
