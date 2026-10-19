import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { CreateProjectGuide } from "@/components/CreateProjectGuide";
import { ProjectFavicon } from "@/components/ProjectFavicon";
import { projectQueries } from "@/lib/queries";

export const Route = createFileRoute("/_app/_dashboard/$orgSlug/")({
  component: OrgIndex,
});

function OrgIndex() {
  const { orgSlug } = Route.useParams();

  const { organization } = Route.useRouteContext();
  const { data: projects } = useSuspenseQuery(projectQueries.list(organization.id));

  if (projects.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <CreateProjectGuide />
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-4xl grid-cols-2 gap-4">
      {projects.map((project) => (
        <Link
          key={project.id}
          to="/$orgSlug/$projectSlug/overview"
          params={{ orgSlug, projectSlug: project.slug }}
          className="bg-card hover:bg-accent/75 flex items-center gap-3 rounded-md border p-5 transition-colors"
        >
          <ProjectFavicon project={project} size={32} className="shrink-0" />
          <div className="min-w-0">
            <h2 className="truncate font-medium">{project.name}</h2>
            <p className="text-muted-foreground mt-1 truncate text-sm">{project.slug}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
