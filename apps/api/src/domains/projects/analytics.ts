import { z } from "zod";

import type { projects } from "./schema";

/**
 * A project's analytics providers: a Project Setting, the same for Live and every draft. Each
 * provider is null when it isn't set up.
 */
export interface AnalyticsProviders {
  ga4: { measurementId: string } | null;
}

/** A GA4 measurement ID: `G-` followed by uppercase letters and digits. */
const ga4MeasurementId = z.string().regex(/^G-[A-Z0-9]+$/, "Not a GA4 measurement ID");

/** Each provider to set, or null to remove it. A provider left out stays as it is. */
export const analyticsProvidersInput = z.object({
  ga4: z.object({ measurementId: ga4MeasurementId }).nullable().optional(),
});

/** The columns storing what `providers` changes. */
export function analyticsColumns(
  providers: z.output<typeof analyticsProvidersInput>,
): Partial<typeof projects.$inferInsert> {
  return {
    ...(providers.ga4 !== undefined && { ga4MeasurementId: providers.ga4?.measurementId ?? null }),
  };
}

export function analyticsOf(project: typeof projects.$inferSelect): AnalyticsProviders {
  return {
    ga4: project.ga4MeasurementId ? { measurementId: project.ga4MeasurementId } : null,
  };
}

/**
 * What the public page data says about its project: enough for the SDK to build a cache-busted
 * favicon URL (`/favicons/${id}?v=${updatedAt}`) and to add the analytics providers' scripts.
 */
export function publicProjectSummary(project: typeof projects.$inferSelect) {
  return { id: project.id, updatedAt: project.updatedAt, analytics: analyticsOf(project) };
}
