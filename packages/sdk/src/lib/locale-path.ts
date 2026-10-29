/**
 * The URL names the locale: a non-default locale's paths sit under its prefix (`/de/preise`), the
 * default locale's have none. The studio's routes follow the same rule (`/de/camox/content`).
 * Pure, so the runtime and the browser share it, and the API reads paths by the same rule.
 */

import { LOCALE_HEADER } from "@camox/api-contract/drafts";
import type { LocalePath, LocaleView } from "@camox/api-contract/locales";

export { localePrefix, localizedPath, parseLocalePath } from "@camox/api-contract/locales";
export type { LocalePath, LocaleView };

/**
 * The default locale where nothing says its tag yet: before a render shows a locale, outside the
 * page runtime, or without an API to read the project's locales from.
 */
export const UNNAMED_DEFAULT_LOCALE: LocaleView = { tag: "und", isDefault: true };

/**
 * The headers naming `locale` in a request (`LOCALE_HEADER`). The default locale is the API's own
 * default, so only another locale is named.
 */
export function localeHeaders(locale: LocaleView | undefined): Record<string, string> {
  return locale && !locale.isDefault ? { [LOCALE_HEADER]: locale.tag } : {};
}

/**
 * Where a page sits in one locale it exists in: the locale's tag and the page's path there, under
 * the locale's prefix. The runtime finds them for `hreflang` links and the sitemap; the
 * alternates hook turns each into an `Alternate` a switcher links to.
 */
export interface AlternatePath {
  locale: string;
  /** The page's runtime path, with its locale's prefix and without the runtime base path. */
  path: string;
}

/**
 * A request's path in its locale: the locales of the scope it reads, the locale its path's
 * prefix names, and the locale-relative path after the prefix.
 */
export interface RequestLocale extends LocalePath {
  locales: LocaleView[];
}
