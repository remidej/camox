import { Label } from "@camox/ui/label";
import { Switch } from "@camox/ui/switch";

import type { Project } from "@/lib/queries";

import { SettingsPart } from "./SettingsPart";
import { useProjectMutation } from "./useProjectMutation";

export function ExperimentalFeaturesSettings({ project }: { project: Project }) {
  const save = useProjectMutation(project, "updateExperimentalFeatures", {
    success: ({ experimentalFeatures }) =>
      experimentalFeatures ? "Experimental features turned on" : "Experimental features turned off",
    failure: "Could not change the experimental features",
  });
  // While saving, the switch shows the change asked for rather than the saved setting.
  const checked = save.isPending
    ? save.variables.experimentalFeatures
    : project.experimentalFeatures;

  return (
    <SettingsPart
      title="Experimental features"
      description="Features still in development, such as collections. They may change or break."
    >
      <div className="flex items-center gap-3">
        <Switch
          id="camox-experimental-features"
          checked={checked}
          disabled={save.isPending}
          onCheckedChange={(experimentalFeatures) =>
            save.mutate({ id: project.id, experimentalFeatures })
          }
        />
        <Label htmlFor="camox-experimental-features">Show experimental features</Label>
      </div>
    </SettingsPart>
  );
}
