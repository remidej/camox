import { Tabs, TabsList, TabsTrigger } from "@camox/ui/tabs";
import { createFileRoute, Link, Outlet, useMatchRoute, useParams } from "@tanstack/react-router";

import { organizationQueries, projectQueries } from "@/lib/queries";

export const Route = createFileRoute("/_app/_dashboard/$orgSlug")({
  // Runs on the server for the first request (cookies are forwarded to the
  // API), so the page arrives with the org active and its projects loaded.
  // Children wait for it: better-auth-ui reads the session's active org.
  beforeLoad: async ({ context, params }) => {
    const { queryClient } = context;
    const findOrg = <T extends { slug: string }>(organizations: T[]) =>
      organizations.find((org) => org.slug === params.orgSlug);
    const [organizations] = await Promise.all([
      queryClient.ensureQueryData(organizationQueries.list()),
      queryClient.ensureQueryData(organizationQueries.setActive(params.orgSlug)),
    ]);
    // The cached list can predate an org the user just created or joined.
    const organization =
      findOrg(organizations) ?? findOrg(await queryClient.fetchQuery(organizationQueries.list()));
    if (!organization) throw new Error("You don't have access to this organization.");
    return { organization };
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(projectQueries.list(context.organization.id));
  },
  errorComponent: ({ error }) => (
    <div className="text-muted-foreground mx-auto max-w-2xl px-6 py-20 text-center">
      <p>{error instanceof Error ? error.message : String(error)}</p>
    </div>
  ),
  component: OrgLayout,
});

function OrgLayout() {
  const { orgSlug } = Route.useParams();
  const matchRoute = useMatchRoute();
  const { projectSlug } = useParams({ strict: false });

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
