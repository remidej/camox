export const STUDIO_ROUTE_SEGMENT = "camox";
export const STUDIO_BASE_PATH = `/${STUDIO_ROUTE_SEGMENT}`;
export const STUDIO_CONTENT_PATH = `${STUDIO_BASE_PATH}/content`;
export const STUDIO_ASSETS_PATH = `${STUDIO_CONTENT_PATH}/assets`;

export const collectionContentPath = (collectionId: string) =>
  `${STUDIO_CONTENT_PATH}/collections/${encodeURIComponent(collectionId)}`;

export const newCollectionItemPath = (collectionId: string) =>
  `${collectionContentPath(collectionId)}/new`;

export const editCollectionItemPath = (collectionId: string, id: string) =>
  `${collectionContentPath(collectionId)}/${encodeURIComponent(id)}/edit`;

export function matchCollectionContentPath(pathname: string) {
  const match = /^\/camox\/content\/collections\/([^/]+)(?:(\/new)|\/([^/]+)\/edit)?$/.exec(
    pathname,
  );
  if (!match) return null;
  try {
    const collectionId = decodeURIComponent(match[1]);
    if (!collectionId || collectionId.includes("/")) return null;
    if (!match[3]) return { collectionId, isNew: !!match[2] };
    const itemId = decodeURIComponent(match[3]);
    if (!itemId || itemId.includes("/")) return null;
    return { collectionId, isNew: false, itemId };
  } catch {
    return null;
  }
}

/** The Studio URL of the Canvas with nothing selected. */
export const STUDIO_CANVAS_PATH = `${STUDIO_BASE_PATH}/canvas`;

export const STUDIO_BLOCKS_PATH = `${STUDIO_BASE_PATH}/blocks`;

/** The Studio URL of a block of the Block Catalog. */
export const blockCatalogPath = (blockId: string) =>
  `${STUDIO_BLOCKS_PATH}/${encodeURIComponent(blockId)}`;

/** The id of the Block Catalog block a pathname selects, if any. */
export function matchBlockCatalogPath(pathname: string) {
  const match = /^\/camox\/blocks\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]) || null;
  } catch {
    return null;
  }
}

/**
 * A location that only exists on the Canvas: the Canvas with
 * nothing selected, or a block of the Block Catalog.
 */
export function matchCanvasOnlyPath(pathname: string): { blockId?: string } | null {
  if (pathname === STUDIO_CANVAS_PATH) return {};
  const blockId = matchBlockCatalogPath(pathname);
  return blockId ? { blockId } : null;
}
