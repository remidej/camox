import { queryKeys } from "@camox/api-contract/query-keys";

import { getPageDestinations } from "../../core/pageDestinations";
import { scopedKey } from "../../lib/studio-draft";
import { fetchRuntimeJson } from "../runtime/navigationTarget";
import type { PageRenderInput } from "../runtime/runtime";

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

/**
 * A Canvas frame's page data. The sidebar reads the same query for the selected page. A
 * code-owned page's data is its loader's result, which reloads with record edits and
 * publication, like other layout reads.
 */
export function canvasPageQuery(
  projectSlug: string,
  runtimeBasePath: string,
  pathname: string,
  derivedLayoutId: string | undefined,
) {
  return {
    queryKey: derivedLayoutId
      ? scopedKey([
          ...queryKeys.layouts.all,
          "canvas",
          projectSlug,
          runtimeBasePath,
          pathname,
          derivedLayoutId,
        ])
      : scopedKey(["camox", "canvas", projectSlug, runtimeBasePath, pathname]),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const response = await fetchRuntimeJson(
        "/_camox/data",
        runtimeBasePath,
        { path: pathname },
        signal,
      );
      if (!response.ok) throw new Error(`Could not load ${pathname} (${response.status}).`);
      const input = (await response.json()) as PageRenderInput;
      validateCanvasPageInput(input, pathname, derivedLayoutId);
      return input;
    },
  };
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
