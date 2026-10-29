/**
 * The URL names the locale (ADR 0015): a non-default locale's paths sit under its prefix
 * (`/de/preise`), the default locale's have none. Pure, so the API, the runtime and the browser
 * read a path the same way.
 */

/** A locale of a project, as `locales.list` returns it. */
export type LocaleView = { tag: string; isDefault: boolean };

/** A runtime path split into the locale it names and the locale-relative path after its prefix. */
export type LocalePath = { locale: LocaleView; path: string };

/** A locale's URL prefix: its tag in lowercase. The default locale has none. */
export function localePrefix(locale: LocaleView): string {
  return locale.isDefault ? "" : `/${locale.tag.toLowerCase()}`;
}

/** A locale-relative path under its locale's prefix, keeping its search and hash: `/` is `/de`. */
export function localizedPath(path: string, locale: LocaleView): string {
  const prefix = localePrefix(locale);
  if (!prefix) return path;
  return path === "/" || /^\/[?#]/.test(path) ? `${prefix}${path.slice(1)}` : `${prefix}${path}`;
}

/**
 * The locale a runtime path names, and the path after its prefix, without search or hash. A first
 * segment that isn't a non-default locale's prefix leaves the path the default locale's. A
 * locale's home is `/de`; `/de/` names it too.
 */
export function parseLocalePath(pathname: string, locales: readonly LocaleView[]): LocalePath {
  const path = pathname.replace(/[?#].*$/s, "") || "/";
  const end = path.indexOf("/", 1);
  const segment = end === -1 ? path.slice(1) : path.slice(1, end);
  const named = locales.find(
    (locale) => !locale.isDefault && localePrefix(locale) === `/${segment}`,
  );
  if (named) return { locale: named, path: end === -1 ? "/" : path.slice(end) };
  const fallback = locales.find((locale) => locale.isDefault);
  if (!fallback) throw new Error("A project's locales include its default locale.");
  return { locale: fallback, path };
}
