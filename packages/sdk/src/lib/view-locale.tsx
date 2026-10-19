import * as React from "react";

import { useLocation } from "../features/navigation/navigation";
import { type LocaleView, localizedPath, parseLocalePath } from "./locale-path";

/**
 * The locale a render shows and the locales of the scope it reads, as the page runtime rendered
 * them. A switch to another locale mounts the page afresh with the next render's, so everything
 * under it reads one locale's keys (ADR 0015: localizations share their original's id).
 */
export type ViewLocale = { locale: LocaleView; locales: readonly LocaleView[] };

export const ViewLocaleContext = React.createContext<ViewLocale | null>(null);

/** The default locale, whose tag nothing names, for a studio mounted outside the page runtime. */
const UNNAMED_DEFAULT_LOCALE: LocaleView = { tag: "und", isDefault: true };
const DEFAULT_VIEW: ViewLocale = {
  locale: UNNAMED_DEFAULT_LOCALE,
  locales: [UNNAMED_DEFAULT_LOCALE],
};

/** The locale the studio views and the scope's locales: the default one outside the runtime. */
export function useViewLocale(): ViewLocale {
  return React.useContext(ViewLocaleContext) ?? DEFAULT_VIEW;
}

/**
 * The current location's path in the locale viewed, after its prefix (`/de/preise` is
 * `/preise`): what page paths, studio routes and the API's `path` inputs compare against.
 */
export function useLocalePath(): string {
  const { locales } = useViewLocale();
  const pathname = useLocation({ select: (location) => location.pathname });
  return parseLocalePath(pathname, locales).path;
}

/** Builds a link to a locale-relative path in the locale viewed: `/preise` is `/de/preise`. */
export function useLocalizedPath(): (path: string) => string {
  const { locale } = useViewLocale();
  return React.useCallback((path: string) => localizedPath(path, locale), [locale]);
}
