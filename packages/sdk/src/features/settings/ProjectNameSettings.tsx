import { Button } from "@camox/ui/button";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { useMutation } from "@tanstack/react-query";
import * as React from "react";

import { type Project, projectMutations } from "@/lib/queries";

import { reads, useStudioCache } from "../../lib/studio-reads";
import { SettingsPart } from "./SettingsPart";

export function ProjectNameSettings({ project }: { project: Project }) {
  const studioCache = useStudioCache();
  const [name, setName] = React.useState(project.name);
  const [error, setError] = React.useState<string | null>(null);

  const save = useMutation({
    ...projectMutations.update(),
    onSuccess: async () => {
      await studioCache.invalidate(reads.project({ projectUuid: project.uuid }));
      toast.success("Project name updated");
    },
    onError: (error) => {
      toast.error(error.message || "Could not update the project name");
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Project name is required");
      return;
    }
    save.mutate({ id: project.id, name });
  };

  return (
    <SettingsPart title="Project name" description="How the project is named in Camox.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="camox-project-name">Project name</Label>
          <Input
            id="camox-project-name"
            value={name}
            aria-invalid={error ? true : undefined}
            disabled={save.isPending}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>
        <Button
          type="submit"
          className="self-start"
          disabled={name === project.name || save.isPending}
        >
          {save.isPending && <Spinner />}
          Save changes
        </Button>
      </form>
    </SettingsPart>
  );
}
