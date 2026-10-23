import { PROJECT_SETUP_STEPS, type ProjectSetupStep } from "@camox/api-contract/projects";
import { Spinner } from "@camox/ui/spinner";
import { CircleCheckIcon, CircleIcon, CircleXIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { Project } from "@/lib/api";
import { cn } from "@/lib/utils";

const STEP_LABELS: Record<ProjectSetupStep, string> = {
  copyTemplate: "Copying the Template",
  build: "Building",
  serve: "Publishing",
};

type StepState = "done" | "running" | "failed" | "pending";

const STEP_ICONS: Record<StepState, ReactNode> = {
  done: <CircleCheckIcon className="size-4 text-emerald-600" />,
  running: <Spinner className="size-4" />,
  failed: <CircleXIcon className="text-destructive size-4" />,
  pending: <CircleIcon className="text-muted-foreground size-4" />,
};

/** What a member is told when their project's setup failed. */
export function ProjectSetupFailure({ className }: { className?: string }) {
  return (
    <p className={cn("text-destructive text-sm", className)}>
      Something went wrong setting up your site. We've been told and will fix it.
    </p>
  );
}

/**
 * The steps a project goes through until its site is live, following its setup: every step
 * before the current one is done, and the current one runs, or failed.
 */
export function ProjectSetup({ project }: { project: Project }) {
  const failed = project.status === "setupFailed";
  const current = PROJECT_SETUP_STEPS.indexOf(project.setupStep ?? "copyTemplate");
  const stateOf = (index: number): StepState => {
    if (index < current) return "done";
    if (index > current) return "pending";
    return failed ? "failed" : "running";
  };

  const steps = [
    ...PROJECT_SETUP_STEPS.map((step, index) => ({
      label: STEP_LABELS[step],
      state: stateOf(index),
    })),
    { label: `Live at ${project.slug}.camox.site`, state: "pending" as const },
  ];

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {steps.map(({ label, state }) => (
          <li key={label} className="flex items-center gap-3 text-sm">
            {STEP_ICONS[state]}
            <span className={state === "pending" ? "text-muted-foreground" : undefined}>
              {label}
            </span>
          </li>
        ))}
      </ol>
      {failed && <ProjectSetupFailure />}
    </div>
  );
}
