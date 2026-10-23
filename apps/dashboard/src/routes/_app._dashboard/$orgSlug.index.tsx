import { Button } from "@camox/ui/button";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { GlobeIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { ProjectCard } from "@/components/ProjectCard";
import { projectQueries } from "@/lib/queries";

export const Route = createFileRoute("/_app/_dashboard/$orgSlug/")({
  component: OrgIndex,
});

function OrgIndex() {
  const { organization } = Route.useRouteContext();
  const { data: projects } = useSuspenseQuery(projectQueries.list(organization.id));
  // An organization without projects has nothing else to do first, so the form opens by itself.
  const [createOpen, setCreateOpen] = useState(projects.length === 0);

  const createButton = (
    <Button onClick={() => setCreateOpen(true)}>
      <PlusIcon />
      Create project
    </Button>
  );

  return (
    <>
      {projects.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
          <GlobeIcon className="h-10 w-10" />
          <h2 className="text-foreground text-lg font-semibold">Create your first project</h2>
          <p className="max-w-sm text-sm">
            Camox sets up your website and hosts it at your own camox.site address.
          </p>
          {createButton}
        </div>
      ) : (
        <div className="mx-auto w-full max-w-4xl space-y-4">
          <div className="flex justify-end">{createButton}</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </div>
      )}
      <CreateProjectDialog
        organizationId={organization.id}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </>
  );
}
