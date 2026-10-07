import { Tabs, TabsList, TabsTrigger } from "@camox/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useMatchRoute, useParams } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_app/_dashboard/$orgSlug")({
  component: OrgLayout,
});

function OrgLayout() {
  const { orgSlug } = Route.useParams();
  const matchRoute = useMatchRoute();
  const { projectSlug } = useParams({ strict: false });

  // Switch the session's active org to match the URL. Passing the slug lets
  // better-auth do slug→id resolution + membership check in one
  // cookie-authenticated round-trip, so newly-created orgs work without
  // depending on a client-side org list. useQuery (non-suspending) keeps
  // this off the SSR path where there's no auth cookie — server-side
  // resolution would always 401 and ship a wrong-org redirect in the HTML.
  // Children stay behind the loader until it resolves; better-auth-ui in the
  // navbar reads from the session and would 401 if mounted earlier.
  const activeOrgQuery = useQuery({
    queryKey: ["organization", "active", orgSlug],
    queryFn: async () => {
      const { data, error } = await authClient.organization.setActive({
        organizationSlug: orgSlug,
      });
      if (error) {
        throw new Error(error.message ?? "You don't have access to this organization.");
      }
      return data;
    },
    staleTime: Infinity,
    retry: false,
  });

  if (activeOrgQuery.isError) {
    return (
      <div className="text-muted-foreground mx-auto max-w-2xl px-6 py-20 text-center">
        <p>{activeOrgQuery.error.message}</p>
      </div>
    );
  }

  if (activeOrgQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (projectSlug) return <Outlet />;

  const isMembers = matchRoute({
    to: "/$orgSlug/members",
    params: { orgSlug },
  });
  const isSettings = matchRoute({
    to: "/$orgSlug/settings",
    params: { orgSlug },
  });

  let activeTab = "projects";
  if (isSettings) activeTab = "settings";
  else if (isMembers) activeTab = "members";

  return (
    <div className="flex flex-col items-stretch gap-6 py-6">
      <div className="px-6">
        <Tabs value={activeTab} className="mx-auto max-w-4xl">
          <TabsList>
            <TabsTrigger
              value="projects"
              nativeButton={false}
              render={<Link to="/$orgSlug" params={{ orgSlug }} />}
            >
              Projects
            </TabsTrigger>
            <TabsTrigger
              value="members"
              nativeButton={false}
              render={<Link to="/$orgSlug/members" params={{ orgSlug }} />}
            >
              Members
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              nativeButton={false}
              render={<Link to="/$orgSlug/settings" params={{ orgSlug }} />}
            >
              Settings
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <Outlet />
    </div>
  );
}
