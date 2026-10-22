import { sendAlert } from "../../lib/alert-email";
import type { Bindings } from "../../types";
import type { ReleaseStep } from "./schema";

/** The release Workflow's name, as `workflows` in wrangler.jsonc declares it. */
const RELEASE_WORKFLOW_NAME = "camox-release";

export type FailedRelease = {
  /** The project by its Project ID, and its name. */
  project: { projectId: string; name: string };
  commit: string;
  failedStep: ReleaseStep;
  workflowInstanceId: string;
};

/** The release's Workflow instance in the Cloudflare dashboard, where its logs are. */
function workflowInstanceUrl(accountId: string, instanceId: string) {
  return `https://dash.cloudflare.com/${accountId}/workers/workflows/${RELEASE_WORKFLOW_NAME}/instance/${encodeURIComponent(instanceId)}`;
}

/** Emails the alerts address that a release gave up. The project keeps serving its previous code. */
export function sendReleaseFailureAlert(env: Bindings, release: FailedRelease): Promise<void> {
  return sendAlert(env, {
    subject: `Release failed: ${release.project.name}`,
    failure: `A release of ${release.project.name} failed at its ${release.failedStep} step. The project keeps serving its previous code.`,
    details: [
      { label: "Project", value: release.project.name },
      { label: "Project ID", value: release.project.projectId },
      { label: "Commit", value: release.commit },
      { label: "Failed step", value: release.failedStep },
    ],
    link: {
      label: "Open the Workflow instance",
      url: workflowInstanceUrl(env.CLOUDFLARE_ACCOUNT_ID, release.workflowInstanceId),
    },
  });
}
