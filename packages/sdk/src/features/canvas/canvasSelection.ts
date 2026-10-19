import { matchDerivedLayout } from "../../core/derivedRoutes";
import { type LocaleView, parseLocalePath } from "../../lib/locale-path";
import type { CanvasPage } from "./canvasPages";

/**
 * The Page a runtime path selects. With the scope's `locales`, derived routes match the path
 * after its locale's prefix, as the runtime matches them.
 */
export function selectedCanvasPage(
  pages: CanvasPage[],
  layouts: Parameters<typeof matchDerivedLayout>[0],
  pathname: string,
  locales?: readonly LocaleView[],
) {
  // Concrete pages take precedence over derived layouts, as they do in the runtime.
  const concrete = pages.find((page) => page.kind !== "derived" && page.pathname === pathname);
  if (concrete) return concrete;
  const path = locales ? parseLocalePath(pathname, locales).path : pathname;
  const derivedLayoutId = matchDerivedLayout(layouts, path)?.layout._internal.id;
  return pages.find((page) => page.kind === "derived" && page.layoutId === derivedLayoutId);
}
