import type { CamoxApp } from "../../core/createApp";
import type { Layout } from "../../core/createLayout";
import { discoverLayoutPages } from "../../core/derivedRoutes";
import { getPageDestinations } from "../../core/pageDestinations";
import { createRequestContext, type RecordLookup } from "../../core/requestContext";

/** A page served on Live, as the sitemap and llms.txt list it. */
export interface LivePage {
  /**
   * Names the page whatever its locale, so its localizations share it: a curated page's id, a
   * singleton's layout, a record page's record, or another derived page's path.
   */
  key: string;
  /** Its path in its locale, without its locale's prefix or the runtime base path. */
  fullPath: string;
  layoutId: string;
  /**
   * What an index calls the page, by page kind: a curated page's meta title (its nickname while
   * it has none), a singleton's layout title, a record page's Label, any other derived page's path.
   */
  title: string;
  description?: string;
  /** Whether `<path>.md` serves its Markdown Representation. */
  hasMarkdown: boolean;
  /** When it last changed, when known. */
  updatedAt?: number;
}

/** A curated page, as the API's page list returns it. */
export interface ListedPage {
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
        key: destination.key,
        fullPath: destination.fullPath,
        layoutId: destination.layoutId,
        title: layout._internal.title,
        hasMarkdown: servesMarkdown(layout),
      };
    }
    const page = pagesById.get(destination.pageId)!;
    return {
      key: destination.key,
      fullPath: page.fullPath,
      layoutId: page.layoutId,
      // A generated meta title is null until generation runs.
      title: page.metaTitle || page.nickname,
      ...(page.metaDescription && { description: page.metaDescription }),
      hasMarkdown: true,
      updatedAt: page.updatedAt,
    };
  });

  const context = createRequestContext({ records });
  const discovered = await Promise.all(
    layouts
      .filter((layout) => layout._internal.kind === "derived")
      .map(async (layout) => {
        const found = await discoverLayoutPages(layout, context).catch((error: unknown) => {
          throw new RouteDiscoveryError(error);
        });
        return found.map((page): LivePage => ({
          key: page.recordId
            ? `record:${layout._internal.id}:${page.recordId}`
            : `derived:${page.path}`,
          fullPath: page.path,
          layoutId: layout._internal.id,
          title: page.label || page.path,
          hasMarkdown: servesMarkdown(layout),
        }));
      }),
  );
  return [...destinations, ...discovered.flat()];
}

/** Whether a layout's pages serve a Markdown Representation. */
function servesMarkdown(layout: Layout) {
  return layout._internal.toMarkdown !== undefined;
}

/** A derived layout's Route Discovery failed, so the Live pages can't all be listed. */
export class RouteDiscoveryError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}
