import * as React from "react";

import { useProjectSlug } from "./auth";
import { localizedPath, type LocaleView, UNNAMED_DEFAULT_LOCALE } from "./locale-path";
import { reads, useReadQuery } from "./studio-reads";
import { useViewLocale } from "./view-locale";

/** A page a link can lead to, at the path a link to it takes. */
export type LinkPage = { id: string; fullPath: string };

/**
 * The pages links lead to in `locale`: its own pages under its prefix, then the default locale's
 * pages missing from it. Localizations keep their original's id (ADR 0015), so a link to a page
 * leads to the rendered locale's page, and to the default locale's where that locale has none.
 * Undefined until the locale's pages load.
 */
export function linkPagesIn(
  locale: LocaleView,
  pages: readonly LinkPage[] | undefined,
  defaultPages: readonly LinkPage[] | undefined,
): LinkPage[] | undefined {
  if (!pages) return undefined;
  if (locale.isDefault) return [...pages];
  const own = new Set(pages.map((page) => page.id));
  return [
    ...pages.map((page) => ({ id: page.id, fullPath: localizedPath(page.fullPath, locale) })),
    ...(defaultPages ?? []).filter((page) => !own.has(page.id)),
  ];
}

/**
 * The site's pages, to resolve links in the locale viewed (see `linkPagesIn`). Every page render
 * seeds them, so the lists are read from the cache. Only a member, whose project the Studio
 * caches, refetches them after a change.
 */
export function useViewPages(): LinkPage[] | undefined {
  const projectSlug = useProjectSlug();
  // Cache only: an anonymous visitor may not read the project, so fetching it would fail.
  const { data: project } = useReadQuery(reads.project({ slug: projectSlug }), { enabled: false });
  return usePageLinks(projectSlug, !!project);
}

/** The pages links lead to in the locale viewed, read once `enabled` (see `linkPagesIn`). */
export function usePageLinks(projectSlug: string, enabled: boolean): LinkPage[] | undefined {
  const { locale, locales } = useViewLocale();
  const defaultLocale = locales.find((each) => each.isDefault) ?? UNNAMED_DEFAULT_LOCALE;
  const { data: pages } = useReadQuery(reads.pageList({ projectSlug }), { enabled });
  const { data: defaultPages } = useReadQuery(reads.pageList({ projectSlug }), {
    enabled: enabled && !locale.isDefault,
    locale: defaultLocale,
  });
  return React.useMemo(
    () => linkPagesIn(locale, pages, defaultPages),
    [locale, pages, defaultPages],
  );
}
