import { Alert, AlertDescription } from "@camox/ui/alert";
import { Separator } from "@camox/ui/separator";
import { Skeleton } from "@camox/ui/skeleton";
import { TriangleAlert } from "lucide-react";
import * as React from "react";

import { useProjectUuid } from "@/lib/auth";
import type { Project } from "@/lib/queries";

import { reads, useReadQuery } from "../../lib/studio-reads";
import { AnalyticsSettings } from "./AnalyticsSettings";
import { ExperimentalFeaturesSettings } from "./ExperimentalFeaturesSettings";
import { FaviconSettings } from "./FaviconSettings";
import { ProjectNameSettings } from "./ProjectNameSettings";
import { SocialProfilesSettings } from "./SocialProfilesSettings";

/** The Settings Section's parts, top to bottom. Each saves on its own. */
const parts: Array<{ id: string; Part: React.ComponentType<{ project: Project }> }> = [
  { id: "name", Part: ProjectNameSettings },
  { id: "favicon", Part: FaviconSettings },
  { id: "social-profiles", Part: SocialProfilesSettings },
  { id: "analytics", Part: AnalyticsSettings },
  { id: "experimental-features", Part: ExperimentalFeaturesSettings },
];

/**
 * The Settings Section (GLOSSARY): where members change Project Settings. They apply to Live and
 * every draft as soon as they're saved, whichever draft the studio is viewing.
 */
export const CamoxSettings = () => {
  const projectUuid = useProjectUuid();
  const { data: project } = useReadQuery(reads.project({ projectUuid }));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6 md:p-10">
      <header className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Settings</h1>
        <Alert variant="warning">
          <TriangleAlert />
          <AlertDescription>
            Settings apply to the live website and every draft as soon as you save them.
          </AlertDescription>
        </Alert>
      </header>
      {project ? (
        parts.map(({ id, Part }, index) => (
          <React.Fragment key={id}>
            {index > 0 && <Separator />}
            <Part project={project} />
          </React.Fragment>
        ))
      ) : (
        <div role="status" aria-label="Loading settings" className="flex flex-col gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}
    </div>
  );
};
