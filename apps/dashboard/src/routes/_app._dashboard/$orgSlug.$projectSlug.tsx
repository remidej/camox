import { Tabs, TabsList, TabsTrigger } from "@camox/ui/tabs";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";

import { projectQueries } from "@/lib/queries";

export const Route = createFileRoute("/_app/_dashboard/$orgSlug/$projectSlug")({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(projectQueries.getBySlug(params.projectSlug));
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { orgSlug, projectSlug } = Route.useParams();
  const matchRoute = useMatchRoute();

  const { data: project } = useSuspenseQuery(projectQueries.getBySlug(projectSlug));

  if (!project) return null;

  const isUsage = matchRoute({
    to: "/$orgSlug/$projectSlug/usage",
    params: { orgSlug, projectSlug },
  });
  const activeTab = isUsage ? "usage" : "overview";

  return (
    <div>
      <div className="px-6 py-6">
        <Tabs value={activeTab} className="mx-auto max-w-4xl">
          <TabsList>
            <TabsTrigger
              value="overview"
              nativeButton={false}
              render={
                <Link to="/$orgSlug/$projectSlug/overview" params={{ orgSlug, projectSlug }} />
              }
            >
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="usage"
              nativeButton={false}
              render={<Link to="/$orgSlug/$projectSlug/usage" params={{ orgSlug, projectSlug }} />}
            >
              Usage
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <Outlet />
    </div>
  );
}
