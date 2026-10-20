/**
 * A page's alternates: where it exists in each locale of the scope rendered (ADR 0015). The head's
 * `hreflang` links, the sitemap's `xhtml:link`s and the alternates hook all come from them.
 */

import type { Layout } from "../../core/createLayout";
import { discoverLayoutPages } from "../../core/derivedRoutes";
import { getPageDestinations } from "../../core/pageDestinations";
import type { LayoutRequestContext } from "../../core/requestContext";
import {
  type AlternatePath,
  localizedPath,
  type LocaleView,
  type RequestLocale,
} from "../../lib/locale-path";
import type { ListedPage, LivePage } from "./livePages";

/**
 * Which page a render shows, whatever its locale: a curated page by its id, a record page by its
 * record, or a code-owned page, whose route isn't localized.
 */
export type PageIdentity =
  | { kind: "curated"; pageId: string }
  | { kind: "record"; layout: Layout; recordId: string }
  | { kind: "code-owned" };

/** What finding a page in another locale reads, in the scope the render reads. */
export interface LocaleReads {
  /** The curated pages of a locale. */
  pages(locale: LocaleView): Promise<readonly ListedPage[]>;
  /** The request context route discovery runs with in a locale. */
  context(locale: LocaleView): LayoutRequestContext;
}

/**
 * The locales a page exists in, in the order of the scope's locales, with its path in each.
 * `located` is where the render found it. A locale that can't be read leaves the page out of it
 * rather than failing the render.
 */
export async function findAlternates({
  identity,
  located: { locale, locales, path },
  layouts,
  reads,
}: {
  identity: PageIdentity;
  located: RequestLocale;
  layouts: readonly Layout[];
  reads: LocaleReads;
}): Promise<AlternatePath[]> {
  const pathIn = async (other: LocaleView): Promise<string | undefined> => {
    if (other.tag === locale.tag) return path;
    // Route patterns aren't localized: a code-owned page has the same path in every locale.
    if (identity.kind === "code-owned") return path;
    if (identity.kind === "curated") {
      const destinations = getPageDestinations(await reads.pages(other), layouts);
      return destinations.find((destination) => destination.key === `page:${identity.pageId}`)
        ?.fullPath;
    }
    const discovered = await discoverLayoutPages(identity.layout, reads.context(other));
    return discovered.find((page) => page.recordId === identity.recordId)?.path;
  };
  const found = await Promise.all(
    locales.map(async (other) => {
      try {
        const otherPath = await pathIn(other);
        return otherPath === undefined
          ? undefined
          : { locale: other.tag, path: localizedPath(otherPath, other) };
      } catch (error) {
        console.error(`[camox] Couldn't find the page's alternate in "${other.tag}".`, error);
        return undefined;
      }
    }),
  );
  return found.filter((alternate) => alternate !== undefined);
}

/** Each page's alternates by its key, from the pages of every locale. */
export function alternatesByPage(
  localizations: ReadonlyArray<{ locale: LocaleView; pages: readonly LivePage[] }>,
): Map<string, AlternatePath[]> {
  const alternates = new Map<string, AlternatePath[]>();
  for (const { locale, pages } of localizations)
    for (const { key, fullPath } of pages) {
      const found = alternates.get(key) ?? [];
      found.push({ locale: locale.tag, path: localizedPath(fullPath, locale) });
      alternates.set(key, found);
    }
  return alternates;
}

/**
 * The `hreflang` links of a page's alternates, plus `x-default` for the default locale's page
 * when it exists. None for a project with a single locale: there is nothing to tell apart.
 */
export function hreflangLinks(
  alternates: readonly AlternatePath[],
  locales: readonly LocaleView[],
  url: (path: string) => string,
): Array<{ hreflang: string; href: string }> {
  if (locales.length < 2) return [];
  const links = alternates.map(({ locale, path }) => ({ hreflang: locale, href: url(path) }));
  const defaultTag = locales.find((locale) => locale.isDefault)?.tag;
  const fallback = alternates.find(({ locale }) => locale === defaultTag);
  if (fallback) links.push({ hreflang: "x-default", href: url(fallback.path) });
  return links;
}
