import { analyticsOf } from "./analytics";
import type { projects } from "./schema";

/**
 * What the public page data says about its project: enough for the SDK to build a cache-busted
 * favicon URL (`/favicons/${id}?v=${updatedAt}`) and to add the analytics providers' scripts.
 */
export function publicProjectSummary(project: typeof projects.$inferSelect) {
  return { id: project.id, updatedAt: project.updatedAt, analytics: analyticsOf(project) };
}
