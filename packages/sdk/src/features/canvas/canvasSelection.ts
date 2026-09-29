import { matchDerivedLayout } from "../../core/derivedRoutes";
import type { CanvasPage } from "./canvasPages";

export function selectedCanvasPage(
  pages: CanvasPage[],
  layouts: Parameters<typeof matchDerivedLayout>[0],
  pathname: string,
) {
  // Concrete pages take precedence over templates, as they do in the runtime.
  const concrete = pages.find((page) => !page.templateId && page.pathname === pathname);
  if (concrete) return concrete;
  const templateId = matchDerivedLayout(layouts, pathname)?.layout._internal.id;
  return pages.find((page) => page.templateId && page.templateId === templateId);
}
