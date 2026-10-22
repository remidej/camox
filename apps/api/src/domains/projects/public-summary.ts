import { analyticsOf } from "./analytics";
import type { projects } from "./schema";

/**
 * What the public page data says about its project: enough for the SDK to build a cache-busted
 * favicon URL (`/favicons/${id}?v=${updatedAt}`), to add the analytics providers' scripts, and to
 * list the social profiles as the Organization's `sameAs`.
 */
export function publicProjectSummary(project: typeof projects.$inferSelect) {
  return {
    id: project.id,
    updatedAt: project.updatedAt,
    analytics: analyticsOf(project),
    socialProfiles: project.socialProfiles,
  };
}
