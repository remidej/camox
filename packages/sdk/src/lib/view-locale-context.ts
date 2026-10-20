import * as React from "react";

import { type LocaleView, type AlternatePath, UNNAMED_DEFAULT_LOCALE } from "./locale-path";

/**
 * The locale a render shows and the locales of the scope it reads, as the page runtime rendered
 * them. A switch to another locale mounts the page afresh with the next render's, so everything
 * under it reads one locale's keys (ADR 0015: localizations share their original's id).
 */
export type ViewLocale = { locale: LocaleView; locales: readonly LocaleView[] };

export const ViewLocaleContext = React.createContext<ViewLocale | null>(null);

/**
 * The page a render shows in every locale it exists in, as the page runtime found it. Null where
 * the render shows no page.
 */
export const PageAlternatesContext = React.createContext<readonly AlternatePath[] | null>(null);

/** The view of a studio mounted outside the page runtime: the default locale alone. */
const DEFAULT_VIEW: ViewLocale = {
  locale: UNNAMED_DEFAULT_LOCALE,
  locales: [UNNAMED_DEFAULT_LOCALE],
};

/** The locale the studio views and the scope's locales: the default one outside the runtime. */
export function useViewLocale(): ViewLocale {
  return React.useContext(ViewLocaleContext) ?? DEFAULT_VIEW;
}
