import { getPageDestinations } from "../../core/pageDestinations";
import type { PageRenderInput } from "../runtime/runtime";

type DestinationLayouts = Parameters<typeof getPageDestinations>[1];

export interface CanvasPage {
  key: string;
  title: string;
  pathname: string | null;
  derivedLayoutId?: string;
  pattern?: string;
  pageId?: number;
  layoutId?: string;
}

export const CANVAS_DEVICES = {
  desktop: { label: "Desktop", width: 1366, height: 900 },
  tablet: { label: "Tablet", width: 768, height: 1024 },
  mobile: { label: "Mobile", width: 390, height: 844 },
} as const;

/** Concrete pages plus one frame per derived layout, never every generated URL. */
export function getCanvasPages(
  pages: Parameters<typeof getPageDestinations>[0],
  layouts: DestinationLayouts,
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
        pathname: segments.some((part) => part.startsWith("$")) ? null : pattern,
        derivedLayoutId: layout.id,
        pattern,
        layoutId: layout.id,
      };
    });
  return [...concrete, ...derivedLayouts];
}

export function validateCanvasPageInput(
  input: Pick<PageRenderInput, "pathname" | "routeKind" | "dehydratedState" | "previewDocument"> & {
    derived?: { layoutId: string };
  },
  pathname: string,
  derivedLayoutId?: string,
) {
  if (
    input.pathname !== pathname ||
    input.routeKind ||
    !input.dehydratedState ||
    !input.previewDocument
  )
    throw new Error("The server did not return a page preview.");
  // Curated routes take precedence over derived routes on the server. Matching
  // the URL pattern alone does not prove this is a page of the derived layout.
  if (derivedLayoutId && input.derived?.layoutId !== derivedLayoutId)
    throw new Error(`This path does not render the selected derived layout (${derivedLayoutId}).`);
}
