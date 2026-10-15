import type { Layout } from "./createLayout";
import { createPageTextLinkTarget } from "./lib/textLinks";

export type PageDestination = {
  key: string;
  title: string;
  fullPath: string;
} & ({ kind: "curated"; pageId: number } | { kind: "singleton"; layoutId: string });

/**
 * Concrete navigable pages, not records that can all be mutated through pages.*. Pages whose
 * layout is gone, or whose URL a singleton serves, aren't served, so they aren't destinations.
 */
export function getPageDestinations(
  pages: readonly {
    id: number;
    nickname: string;
    fullPath: string;
    needsLayout?: boolean;
    shadowed?: boolean;
  }[],
  layouts: readonly { _internal: Pick<Layout["_internal"], "id" | "kind" | "title"> }[],
): PageDestination[] {
  return [
    ...pages
      .filter((page) => !page.needsLayout && !page.shadowed)
      .map(
        (page): PageDestination => ({
          key: `page:${page.id}`,
          kind: "curated",
          pageId: page.id,
          title: page.nickname,
          fullPath: page.fullPath,
        }),
      ),
    ...layouts
      .filter((layout) => layout._internal.kind === "singleton")
      .map(
        ({ _internal: layout }): PageDestination => ({
          key: `singleton:${layout.id}`,
          kind: "singleton",
          layoutId: layout.id,
          title: layout.title,
          fullPath: `/${layout.id.split(".").map(encodeURIComponent).join("/")}`,
        }),
      ),
  ];
}

/** Singleton links are ordinary internal URLs, never synthetic database page IDs. */
export function destinationLink(destination: PageDestination) {
  if (destination.kind === "curated")
    return { type: "page" as const, pageId: String(destination.pageId) };
  return { type: "external" as const, href: destination.fullPath };
}

export function destinationTextLink(destination: PageDestination) {
  if (destination.kind === "curated") return createPageTextLinkTarget(destination.pageId);
  return destination.fullPath;
}
