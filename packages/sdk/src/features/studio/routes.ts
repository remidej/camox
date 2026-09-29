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
