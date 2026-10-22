import type { ProjectSetupStep } from "@camox/api-contract/projects";

import { type AlertProject, projectDetails, sendAlert, workflowLink } from "../../lib/alert-email";
import type { Bindings } from "../../types";

/** The creation Workflow's name, as `workflows` in wrangler.jsonc declares it. */
const CREATION_WORKFLOW_NAME = "camox-project-creation";

/** Each setup step, as the project's page names it. */
const SETUP_STEP_NAMES: Record<ProjectSetupStep, string> = {
  copyTemplate: "Copying the Template",
  build: "Building",
  serve: "Publishing",
};

export type FailedSetup = {
  project: AlertProject;
  failedStep: ProjectSetupStep;
  /** The creation Workflow's instance that gave up, or null when it couldn't be started. */
  workflowInstanceId: string | null;
};

/** Emails the alerts address that a new project's setup gave up before its first release. */
export function sendSetupFailureAlert(env: Bindings, setup: FailedSetup): Promise<void> {
  const step = SETUP_STEP_NAMES[setup.failedStep];
  const { name } = setup.project;
  const failure =
    setup.workflowInstanceId === null
      ? `Setting up ${name} failed before its creation Workflow started.`
      : `Setting up ${name} failed at ${step}.`;
  return sendAlert(env, {
    subject: `Setup failed: ${name}`,
    failure: `${failure} Its page tells its organization that Camox will fix it.`,
    details: [...projectDetails(setup.project), { label: "Failed step", value: step }],
    link: workflowLink(env, CREATION_WORKFLOW_NAME, setup.workflowInstanceId),
  });
}
