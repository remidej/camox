export const STUDIO_ROUTE_SEGMENT = "camox";
export const STUDIO_BASE_PATH = `/${STUDIO_ROUTE_SEGMENT}`;
export const STUDIO_CONTENT_PATH = `${STUDIO_BASE_PATH}/content`;

export const collectionContentPath = (collectionId: string) =>
  `${STUDIO_CONTENT_PATH}/collections/${encodeURIComponent(collectionId)}`;

export const newCollectionItemPath = (collectionId: string) =>
  `${collectionContentPath(collectionId)}/new`;

export function matchCollectionContentPath(pathname: string) {
  const match = /^\/camox\/content\/collections\/([^/]+)(\/new)?$/.exec(pathname);
  if (!match) return null;
  try {
    const collectionId = decodeURIComponent(match[1]);
    if (!collectionId || collectionId.includes("/")) return null;
    return { collectionId, isNew: !!match[2] };
  } catch {
    return null;
  }
}
