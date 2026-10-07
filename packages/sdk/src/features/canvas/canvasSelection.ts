import { matchDerivedLayout } from "../../core/derivedRoutes";
import type { CanvasPage } from "./canvasPages";

export function selectedCanvasPage(
  pages: CanvasPage[],
  layouts: Parameters<typeof matchDerivedLayout>[0],
  pathname: string,
) {
  // Concrete pages take precedence over derived layouts, as they do in the runtime.
  const concrete = pages.find((page) => !page.derivedLayoutId && page.pathname === pathname);
  if (concrete) return concrete;
  const derivedLayoutId = matchDerivedLayout(layouts, pathname)?.layout._internal.id;
  return pages.find((page) => page.derivedLayoutId && page.derivedLayoutId === derivedLayoutId);
}
