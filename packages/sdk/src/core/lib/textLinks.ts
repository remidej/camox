export const PAGE_TEXT_LINK_PREFIX = "camox:page:";

export function getPageIdFromTextLinkTarget(target: string): string | null {
  if (!target.startsWith(PAGE_TEXT_LINK_PREFIX)) return null;
  const pageId = target.slice(PAGE_TEXT_LINK_PREFIX.length);
  if (!pageId) return null;
  return pageId;
}

export function createPageTextLinkTarget(pageId: string | number): string {
  return `${PAGE_TEXT_LINK_PREFIX}${pageId}`;
}

export function isHttpTextLinkTarget(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

export function isInternalTextLinkTarget(target: string): boolean {
  // Root-relative URLs only: reject protocol-relative URLs, backslashes, and controls.
  return /^\/(?!\/)[^\s\\\p{Cc}]*$/u.test(target);
}

export function isValidTextLinkTarget(target: string): boolean {
  return (
    getPageIdFromTextLinkTarget(target) != null ||
    isHttpTextLinkTarget(target) ||
    isInternalTextLinkTarget(target)
  );
}

export function resolveTextLinkHref(
  target: string,
  pages: Array<{ id: number; fullPath: string }> | undefined,
  fallbackHref: string,
): string | null {
  const pageId = getPageIdFromTextLinkTarget(target);
  if (pageId == null) {
    return isValidTextLinkTarget(target) ? target : null;
  }

  const page = pages?.find((p) => String(p.id) === pageId);
  return page?.fullPath ?? fallbackHref;
}

export function shouldOpenTextLinkInNewTab(target: string): boolean {
  return isHttpTextLinkTarget(target);
}
