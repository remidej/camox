import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export const organizationQueries = {
  all: () => ["organization"] as const,

  list: () =>
    queryOptions({
      queryKey: [...organizationQueries.all(), "list"] as const,
      queryFn: async () => {
        const { data } = await authClient.organization.list();
        return data ?? [];
      },
    }),

  /**
   * Makes the org in the URL the session's active org, which better-auth-ui's
   * members and settings cards read. Passing the slug lets better-auth resolve
   * it and check membership in one round-trip.
   */
  setActive: (slug: string) =>
    queryOptions({
      queryKey: [...organizationQueries.all(), "active", slug] as const,
      queryFn: async () => {
        const { data, error } = await authClient.organization.setActive({
          organizationSlug: slug,
        });
        if (error || !data) {
          throw new Error(error?.message ?? "You don't have access to this organization.");
        }
        return data;
      },
      staleTime: Infinity,
      retry: false,
    }),
};

export const projectQueries = {
  all: () => ["projects"] as const,

  list: (organizationId: string) =>
    queryOptions({
      queryKey: [...projectQueries.all(), "list", organizationId] as const,
      queryFn: () => api.projects.list({ organizationId }),
    }),

  getBySlug: (slug: string) =>
    queryOptions({
      queryKey: [...projectQueries.all(), "getBySlug", slug] as const,
      queryFn: () => api.projects.getBySlug({ slug }),
    }),
};
