import * as React from "react";

import { localizedPath, type LocaleView, UNNAMED_DEFAULT_LOCALE } from "./locale-path";
import type { Page } from "./queries";
import { reads, useReadQuery } from "./studio-reads";
import { useViewLocale } from "./view-locale-context";

// Localizations keep their original's id (ADR 0015), so a page link names the same page in every
// locale. It leads to the rendered locale's page, and to the default locale's page where that
// locale has none: removing a page from a locale never breaks links to it.

/** A page a link can lead to, at the path a link to it takes. */
export type LinkPage = { id: string; fullPath: string };

/**
 * The locale whose pages links fall back to from `locale`: the default locale, or none in the
 * default locale itself. Its tag is never read: reads name the default locale by none.
 */
export function linkFallbackLocale(locale: LocaleView): LocaleView | null {
  return locale.isDefault ? null : UNNAMED_DEFAULT_LOCALE;
}

/**
 * The pages a link can lead to from a locale, given its pages and its fallback locale's: its own,
 * then the fallback's pages it has no localization of.
 */
export function linkablePages<P extends { id: string }>(
  pages: readonly P[],
  fallbackPages: readonly P[] | undefined,
): { page: P; own: boolean }[] {
  const own = new Set(pages.map((page) => page.id));
  return [
    ...pages.map((page) => ({ page, own: true })),
    ...(fallbackPages ?? [])
      .filter((page) => !own.has(page.id))
      .map((page) => ({ page, own: false })),
  ];
}

/**
 * The pages links lead to in `locale`, at their paths: its own pages under its prefix, then the
 * default locale's pages it misses. Undefined until the locale's pages load.
 */
export function linkPagesIn(
  locale: LocaleView,
  pages: readonly LinkPage[] | undefined,
  fallbackPages: readonly LinkPage[] | undefined,
): LinkPage[] | undefined {
  if (!pages) return undefined;
  return linkablePages(pages, fallbackPages).map(({ page, own }) => ({
    id: page.id,
    fullPath: own ? localizedPath(page.fullPath, locale) : page.fullPath,
  }));
}

/**
 * Selects the page list as is. Selected values keep their identity while their content does, so
 * fields don't re-render when a frame hydrates an equal list.
 */
const samePageList = (pages: Page[]) => pages;
/** Selects only that a read loaded, so fields don't re-render as its value changes. */
const isLoaded = () => true;

/**
 * The pages a link can lead to in the locale viewed (see `linkablePages`), undefined until they
 * load. A site render seeds them, so by default the project they wait for is read from the cache
 * only: an anonymous visitor may not read the project, so fetching it would fail. The studio's
 * editors fetch it with `fetchProject`.
 */
export function useLinkablePages(
  projectSlug: string,
  { fetchProject = false }: { fetchProject?: boolean } = {},
): { locale: LocaleView; pages: Page[] | undefined; fallbackPages: Page[] | undefined } {
  const { locale } = useViewLocale();
  const fallback = linkFallbackLocale(locale);
  const { data: projectLoaded } = useReadQuery(reads.project({ slug: projectSlug }), {
    enabled: fetchProject,
    select: isLoaded,
  });
  const { data: pages } = useReadQuery(reads.pageList({ projectSlug }), {
    enabled: !!projectLoaded,
    select: samePageList,
  });
  const { data: fallbackPages } = useReadQuery(reads.pageList({ projectSlug }), {
    enabled: !!projectLoaded && fallback !== null,
    locale: fallback ?? undefined,
    select: samePageList,
  });
  return { locale, pages, fallbackPages: fallback ? fallbackPages : undefined };
}

/** The pages links lead to in the locale viewed, at their paths (see `linkPagesIn`). */
export function useLinkPages(
  projectSlug: string,
  options?: { fetchProject?: boolean },
): LinkPage[] | undefined {
  const { locale, pages, fallbackPages } = useLinkablePages(projectSlug, options);
  return React.useMemo(
    () => linkPagesIn(locale, pages, fallbackPages),
    [locale, pages, fallbackPages],
  );
}
