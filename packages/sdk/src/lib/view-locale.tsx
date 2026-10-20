import * as React from "react";

import { useLocation } from "../features/navigation/navigation";
import { localizedPath, parseLocalePath } from "./locale-path";
import { useViewLocale } from "./view-locale-context";

export { type ViewLocale, ViewLocaleContext, useViewLocale } from "./view-locale-context";

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
