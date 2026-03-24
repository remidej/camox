import { api } from "@camox/backend-management/_generated/api";
import { convexQuery } from "@convex-dev/react-query";
import { OrganizationSwitcher, useCurrentOrganization } from "@daveyplate/better-auth-ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";

export const Route = createFileRoute("/_app/dashboard/")({
  head: () => ({
    meta: [{ title: "Camox Dashboard" }],
  }),
  component: DashboardIndex,
});

function DashboardIndex() {
  const { data: organization } = useCurrentOrganization();

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-8">
        <h1 className="mb-4 text-lg font-semibold">Team projects</h1>
        <OrganizationSwitcher variant="ghost" size="default" className="min-w-64" hidePersonal />
      </div>

      {organization && <ProjectList organizationSlug={organization.slug} />}
    </div>
  );
}

function ProjectList({ organizationSlug }: { organizationSlug: string }) {
  const { data: projects } = useQuery(convexQuery(api.projects.listProjects, { organizationSlug }));

  if (!projects) return null;
  if (projects.length === 0) {
    return <p className="text-muted-foreground text-sm">No projects yet.</p>;
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Projects</h2>
      <div className="grid gap-3">
        {projects.map((project) => (
          <Link
            key={project._id}
            to="/dashboard/$slug/overview"
            params={{ slug: project.slug }}
            className="border-border hover:border-foreground/20 flex items-center justify-between rounded-lg border p-4 transition-colors"
          >
            <div>
              <p className="font-medium">{project.name}</p>
              {project.description && (
                <p className="text-muted-foreground text-sm">{project.description}</p>
              )}
            </div>
            <ArrowRightIcon className="text-muted-foreground h-4 w-4 shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}
