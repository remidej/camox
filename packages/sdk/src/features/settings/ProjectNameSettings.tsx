import { Button } from "@camox/ui/button";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { Spinner } from "@camox/ui/spinner";
import * as React from "react";

import type { Project } from "@/lib/queries";

import { SettingsPart } from "./SettingsPart";
import { useProjectMutation } from "./useProjectMutation";

export function ProjectNameSettings({ project }: { project: Project }) {
  const [name, setName] = React.useState(project.name);
  const [error, setError] = React.useState<string | null>(null);

  const save = useProjectMutation(project, "update", {
    success: "Project name updated",
    failure: "Could not update the project name",
  });

  const trimmedName = name.trim();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmedName) {
      setError("Project name is required");
      return;
    }
    save.mutate({ id: project.id, name: trimmedName });
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
          disabled={trimmedName === project.name || save.isPending}
        >
          {save.isPending && <Spinner />}
          Save changes
        </Button>
      </form>
    </SettingsPart>
  );
}
