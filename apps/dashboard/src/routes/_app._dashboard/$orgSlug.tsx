import { Button } from "@camox/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@camox/ui/tabs";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { CreateProjectContext, CreateProjectDialog } from "@/components/CreateProjectDialog";
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
  const { organization } = Route.useRouteContext();
  const { data: projects } = useSuspenseQuery(projectQueries.list(organization.id));
  const matchRoute = useMatchRoute();

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

  // An organization without projects has nothing else to do first, so the form opens by itself.
  const [createOpen, setCreateOpen] = useState(
    () => activeTab === "projects" && projects.length === 0,
  );

  return (
    <CreateProjectContext value={() => setCreateOpen(true)}>
      <div className="flex flex-col items-stretch gap-6 py-6">
        <div className="px-6">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <Tabs value={activeTab}>
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
            {/* Without projects, the projects tab's empty state has its own button. */}
            {activeTab === "projects" && projects.length > 0 && (
              <Button onClick={() => setCreateOpen(true)}>
                <PlusIcon />
                Create project
              </Button>
            )}
          </div>
        </div>
        <Outlet />
      </div>
      <CreateProjectDialog
        organizationId={organization.id}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </CreateProjectContext>
  );
}
