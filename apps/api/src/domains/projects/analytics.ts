import { ga4MeasurementIdSchema } from "@camox/api-contract/analytics";
import { z } from "zod";

import type { projects } from "./schema";

/**
 * A project's analytics providers: a Project Setting, the same for Live and every draft. Each
 * provider is null when it isn't set up.
 */
export interface AnalyticsProviders {
  ga4: { measurementId: string } | null;
}

/** Each provider to set, or null to remove it. A provider left out stays as it is. */
export const analyticsProvidersInput = z.object({
  ga4: z.object({ measurementId: ga4MeasurementIdSchema }).nullable().optional(),
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
