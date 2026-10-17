import { getPageDestinations } from "../../core/pageDestinations";

type DestinationLayouts = Parameters<typeof getPageDestinations>[1];

export interface CanvasPage {
  key: string;
  title: string;
  pathname: string | null;
  derivedLayoutId?: string;
  pattern?: string;
  pageId?: string;
  layoutId?: string;
}

export const CANVAS_DEVICES = {
  desktop: { label: "Desktop", width: 1366, height: 900 },
  tablet: { label: "Tablet", width: 768, height: 1024 },
  mobile: { label: "Mobile", width: 390, height: 844 },
} as const;

/**
 * Concrete pages plus one frame per derived layout, never every generated URL.
 * A derived frame previews its layout's first discovered page until a path is chosen.
 */
export function getCanvasPages(
  pages: Parameters<typeof getPageDestinations>[0],
  layouts: DestinationLayouts,
  discoveredPaths?: ReadonlyMap<string, string>,
): CanvasPage[] {
  const concrete = getPageDestinations(pages, layouts).map((page) => ({
    key: page.key,
    title: page.title,
    pathname: page.fullPath,
    ...(page.kind === "curated" ? { pageId: page.pageId } : { layoutId: page.layoutId }),
  }));
  const derivedLayouts = layouts
    .filter((layout) => layout._internal.kind === "derived")
    .map(({ _internal: layout }) => {
      const segments = layout.id.split(".");
      const pattern = `/${segments.map((part) => (part.startsWith("$") ? `:${part.slice(1)}` : encodeURIComponent(part))).join("/")}`;
      return {
        key: `derived:${layout.id}`,
        title: layout.title,
        pathname: segments.some((part) => part.startsWith("$"))
          ? (discoveredPaths?.get(layout.id) ?? null)
          : pattern,
        derivedLayoutId: layout.id,
        pattern,
        layoutId: layout.id,
      };
    });
  return [...concrete, ...derivedLayouts];
}
