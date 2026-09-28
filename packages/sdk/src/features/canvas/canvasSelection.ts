import { matchDerivedLayout } from "../../core/derivedRoutes";
import { STUDIO_CANVAS_PATH } from "../studio/routes";
import type { CanvasPage } from "./canvasPages";

/** The bare canvas URL represents the homepage. Paths stay URL-encoded. */
export function selectedCanvasPath(pathname: string) {
  return pathname.slice(STUDIO_CANVAS_PATH.length) || "/";
}

export function canvasSelectionUrl(pathname: string) {
  return `${STUDIO_CANVAS_PATH}${pathname === "/" ? "" : pathname}`;
}

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
