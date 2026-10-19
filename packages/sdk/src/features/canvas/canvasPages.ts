import { getPageDestinations } from "../../core/pageDestinations";
import { type LocaleView, localizedPath, UNNAMED_DEFAULT_LOCALE } from "../../lib/locale-path";

type DestinationLayouts = Parameters<typeof getPageDestinations>[1];

type CanvasPageBase = { key: string; title: string; pathname: string | null };

/**
 * A Page on the Canvas. A curated page has its own page row. A layout page, singleton
 * or derived, has none: its layout owns all its blocks, and its URL comes from code.
 */
export type CanvasPage =
  | (CanvasPageBase & { kind: "curated"; pageId: string })
  | (CanvasPageBase & { kind: "singleton"; layoutId: string })
  | (CanvasPageBase & {
      kind: "derived";
      layoutId: string;
      /** The route pattern, shown while no page path is chosen. */
      pattern: string;
    });

export type DerivedCanvasPage = Extract<CanvasPage, { kind: "derived" }>;

/** The page row a curated page edits. */
export function canvasPageId(page: CanvasPage | undefined) {
  return page?.kind === "curated" ? page.pageId : undefined;
}

/** The layout a layout page edits, singleton or derived. */
export function canvasLayoutId(page: CanvasPage | undefined) {
  return page && page.kind !== "curated" ? page.layoutId : undefined;
}

/** The derived layout a derived page's frame must render. */
export function derivedLayoutIdOf(page: CanvasPage | undefined) {
  return page?.kind === "derived" ? page.layoutId : undefined;
}

/** A Page's path, or its route pattern while a derived page has no path yet. */
export function canvasPagePath(page: CanvasPage) {
  return page.pathname ?? (page.kind === "derived" ? page.pattern : null);
}

export const CANVAS_DEVICES = {
  desktop: { label: "Desktop", width: 1366, height: 900 },
  tablet: { label: "Tablet", width: 768, height: 1024 },
  mobile: { label: "Mobile", width: 390, height: 844 },
} as const;

/**
 * Concrete pages plus one frame per derived layout, never every generated URL.
 * A derived frame previews its layout's first discovered page until a path is chosen.
 * Paths are runtime paths in `locale`, under its prefix; `pages` are its localizations, and
 * `discoveredPaths` the paths route discovery found in it, after its prefix.
 */
export function getCanvasPages(
  pages: Parameters<typeof getPageDestinations>[0],
  layouts: DestinationLayouts,
  discoveredPaths?: ReadonlyMap<string, string>,
  locale: LocaleView = UNNAMED_DEFAULT_LOCALE,
): CanvasPage[] {
  const inLocale = (path: string) => localizedPath(path, locale);
  const discoveredPathIn = (layoutId: string) => {
    const path = discoveredPaths?.get(layoutId);
    return path ? inLocale(path) : null;
  };
  const concrete = getPageDestinations(pages, layouts).map((page): CanvasPage =>
    page.kind === "curated"
      ? {
          kind: "curated",
          key: page.key,
          title: page.title,
          pathname: inLocale(page.fullPath),
          pageId: page.pageId,
        }
      : {
          kind: "singleton",
          key: page.key,
          title: page.title,
          pathname: inLocale(page.fullPath),
          layoutId: page.layoutId,
        },
  );
  const derivedLayouts = layouts
    .filter((layout) => layout._internal.kind === "derived")
    .map(({ _internal: layout }): CanvasPage => {
      const segments = layout.id.split(".");
      const pattern = `/${segments.map((part) => (part.startsWith("$") ? `:${part.slice(1)}` : encodeURIComponent(part))).join("/")}`;
      return {
        kind: "derived",
        key: `derived:${layout.id}`,
        title: layout.title,
        pathname: segments.some((part) => part.startsWith("$"))
          ? discoveredPathIn(layout.id)
          : inLocale(pattern),
        layoutId: layout.id,
        pattern,
      };
    });
  return [...concrete, ...derivedLayouts];
}
