import type { ProjectSetupStep } from "@camox/api-contract/projects";

import { sendAlert } from "../../lib/alert-email";
import type { Bindings } from "../../types";

/** The creation Workflow's name, as `workflows` in wrangler.jsonc declares it. */
const CREATION_WORKFLOW_NAME = "camox-project-creation";

/** Each setup step, as the project's page names it. */
const SETUP_STEP_NAMES: Record<ProjectSetupStep, string> = {
  copyTemplate: "Copying the Template",
  build: "Building",
  publish: "Publishing",
};

export type FailedSetup = {
  /** The project by its Project ID, and its name. */
  project: { projectId: string; name: string };
  failedStep: ProjectSetupStep;
  workflowInstanceId: string;
};

/** Emails the alerts address that a new project's setup gave up before its first release. */
export function sendSetupFailureAlert(env: Bindings, setup: FailedSetup): Promise<void> {
  const step = SETUP_STEP_NAMES[setup.failedStep];
  return sendAlert(env, {
    subject: `Setup failed: ${setup.project.name}`,
    failure: `Setting up ${setup.project.name} failed at ${step}. Its page tells its organization that Camox will fix it.`,
    details: [
      { label: "Project", value: setup.project.name },
      { label: "Project ID", value: setup.project.projectId },
      { label: "Failed step", value: step },
    ],
    link: {
      label: "Open the Workflow instance",
      url: `https://dash.cloudflare.com/${env.CLOUDFLARE_ACCOUNT_ID}/workers/workflows/${CREATION_WORKFLOW_NAME}/instance/${encodeURIComponent(setup.workflowInstanceId)}`,
    },
  });
}
