/**
 * A page's breadcrumb: where it sits in the website, by path. Its crumbs are the page's ancestors
 * Camox can name without running a loader (curated pages, singletons and record pages), from the
 * home page down to the page itself. Breadcrumbs belong to Camox alone: blocks declare nothing.
 */

import type { CamoxApp } from "../../core/createApp";
import { matchDerivedLayout } from "../../core/derivedRoutes";
import { curatedPageTitle } from "../../core/layoutContext";
import { getPageDestinations } from "../../core/pageDestinations";
import { recordPageValues } from "../../core/recordItem";
import type { RecordLookup } from "../../core/requestContext";
import type { ListedPage } from "./livePages";

/** One crumb: a page's undecorated title, and its path in the page's locale, without prefix. */
export interface Crumb {
  name: string;
  path: string;
}

/** What naming a page's ancestors reads, in the scope and locale the page renders in. */
export interface BreadcrumbReads {
  /** The locale's curated pages, in one read whatever the page's depth. */
  pages(): Promise<readonly ListedPage[]>;
  records: RecordLookup | undefined;
}

/** The paths above a page's, from the home page down: none for the home page itself. */
function ancestorPaths(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return [];
  return [
    "/",
    ...segments.slice(1).map((_, index) => `/${segments.slice(0, index + 1).join("/")}`),
  ];
}

/**
 * A page's crumbs, ending with the page itself, which `title` names. The home page has none. An
 * ancestor that isn't a page, or is a derived page other than a record page, is left out.
 */
export async function readBreadcrumb({
  path,
  title,
  app,
  reads,
}: {
  /** The page's path, without its locale's prefix. */
  path: string;
  /** The page's undecorated title. */
  title: string;
  app: CamoxApp | undefined;
  reads: BreadcrumbReads;
}): Promise<Crumb[]> {
  const ancestors = ancestorPaths(path);
  if (ancestors.length === 0) return [];
  const layouts = app?.getLayouts() ?? [];
  const pages = await reads.pages();
  const destinations = getPageDestinations(pages, layouts);
  const pagesByPath = new Map(pages.map((page) => [page.fullPath, page]));
  const named = await Promise.all(
    ancestors.map(async (ancestor): Promise<Crumb | undefined> => {
      // Singletons take precedence over curated pages, which take precedence over derived ones.
      const destination =
        destinations.find((d) => d.kind === "singleton" && d.fullPath === ancestor) ??
        destinations.find((d) => d.kind === "curated" && d.fullPath === ancestor);
      if (destination?.kind === "singleton") return { name: destination.title, path: ancestor };
      if (destination?.kind === "curated") {
        const page = pagesByPath.get(ancestor)!;
        return { name: curatedPageTitle(page), path: ancestor };
      }
      const name = await recordPageTitle(app, ancestor, reads.records);
      return name === undefined ? undefined : { name, path: ancestor };
    }),
  );
  return [...named.filter((crumb) => crumb !== undefined), { name: title, path }];
}

/**
 * The title of the record a record page at `path` renders, found by its route param as the
 * page's own read finds it. Undefined when no record page is there.
 */
async function recordPageTitle(
  app: CamoxApp | undefined,
  path: string,
  records: RecordLookup | undefined,
): Promise<string | undefined> {
  const match = app && matchDerivedLayout(app.getLayouts(), path);
  const recordPages = match?.layout._internal.recordPages;
  if (!match || !recordPages || !records) return undefined;
  const value = recordPages.param
    ? match.params[recordPages.param]
    : // A hand-written record layout names no param: its route's only one holds the value.
      Object.values(match.params).length === 1
      ? Object.values(match.params)[0]
      : undefined;
  const collection = app.getCollectionById(recordPages.collectionId);
  if (!value || !collection) return undefined;
  const found = await records.findByField({
    collectionId: recordPages.collectionId,
    field: recordPages.field,
    value,
  });
  // A page showing one of several matching records doesn't exist: its own read fails.
  if (found.length !== 1) return undefined;
  return recordPageValues(collection, { data: found[0]! }).title;
}
