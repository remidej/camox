import type { CamoxApp } from "../../core/createApp";
import { discoverLayoutPages } from "../../core/derivedRoutes";
import { getPageDestinations } from "../../core/pageDestinations";
import { createRequestContext, type RecordLookup } from "../../core/requestContext";

/** A page served on Live, as the sitemap and llms.txt list it. */
export interface LivePage {
  /** Its path, without the runtime base path. */
  fullPath: string;
  layoutId: string;
  title: string;
  description?: string;
  /** Whether `<path>.md` serves its Markdown Representation. */
  hasMarkdown: boolean;
  /** When it last changed, when known. */
  updatedAt?: number;
}

/** A curated page, as the API's page list returns it. */
interface ListedPage {
  id: string;
  nickname: string;
  fullPath: string;
  layoutId: string;
  metaTitle: string | null;
  metaDescription: string | null;
  updatedAt: number;
  needsLayout?: boolean;
  shadowed?: boolean;
}

/**
 * The pages served on Live: curated pages and singletons (without pages missing their layout or
 * shadowed by a singleton), then the pages derived layouts discover. `records` must read Live.
 * Rejects when a layout's Route Discovery fails: an index silently missing pages is worse.
 */
export async function listLivePages({
  pages,
  app,
  records,
}: {
  pages: readonly ListedPage[];
  app: CamoxApp | undefined;
  records: RecordLookup | undefined;
}): Promise<LivePage[]> {
  const layouts = app?.getLayouts() ?? [];
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const destinations = getPageDestinations(pages, layouts).map((destination): LivePage => {
    if (destination.kind === "singleton") {
      const layout = layouts.find(({ _internal }) => _internal.id === destination.layoutId)!;
      return {
        fullPath: destination.fullPath,
        layoutId: destination.layoutId,
        title: layout._internal.title,
        hasMarkdown: layout._internal.toMarkdown !== undefined,
      };
    }
    const page = pagesById.get(destination.pageId)!;
    return {
      fullPath: page.fullPath,
      layoutId: page.layoutId,
      title: page.metaTitle || page.nickname,
      ...(page.metaDescription && { description: page.metaDescription }),
      hasMarkdown: true,
      updatedAt: page.updatedAt,
    };
  });

  // Record pages are named by their record's Label, which discovery reads along with the records.
  const labels = new Map<string, string>();
  const context = createRequestContext({
    records: records && {
      ...records,
      listPageValues: async (input) => {
        const values = await records.listPageValues(input);
        for (const value of values) labels.set(value.id, value.label);
        return values;
      },
    },
  });
  const discovered = await Promise.all(
    layouts
      .filter((layout) => layout._internal.kind === "derived")
      .map(async (layout) => {
        const found = await discoverLayoutPages(layout, context).catch((error: unknown) => {
          throw new RouteDiscoveryError(error);
        });
        return found.map((page): LivePage => ({
          fullPath: page.path,
          layoutId: layout._internal.id,
          title: (page.recordId && labels.get(page.recordId)) || page.path,
          hasMarkdown: layout._internal.toMarkdown !== undefined,
        }));
      }),
  );
  return [...destinations, ...discovered.flat()];
}

/** A derived layout's Route Discovery failed, so the Live pages can't all be listed. */
export class RouteDiscoveryError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}
