import { sendAlert } from "../../lib/alert-email";
import type { Bindings } from "../../types";

/** The deletion Workflow's name, as `workflows` in wrangler.jsonc declares it. */
const DELETION_WORKFLOW_NAME = "camox-project-deletion";

export type FailedCleanup = {
  /** The deleted project by its Project ID, and its name. */
  project: { projectId: string; name: string };
  /** The steps that gave up, as the alert names them, such as "Deleting the Worker". */
  failedSteps: string[];
  workflowInstanceId: string;
};

/** Emails the alerts address that a deleted project's cleanup gave up, leaving resources behind. */
export function sendCleanupFailureAlert(env: Bindings, cleanup: FailedCleanup): Promise<void> {
  const { name, projectId } = cleanup.project;
  return sendAlert(env, {
    subject: `Cleanup failed: ${name}`,
    failure: `Cleaning up the deleted project ${name} failed. Its site is offline, but what the failed steps delete is still on Cloudflare.`,
    details: [
      { label: "Project", value: name },
      { label: "Project ID", value: projectId },
      { label: "Failed step", value: cleanup.failedSteps.join(", ") },
    ],
    link: {
      label: "Open the Workflow instance",
      url: `https://dash.cloudflare.com/${env.CLOUDFLARE_ACCOUNT_ID}/workers/workflows/${DELETION_WORKFLOW_NAME}/instance/${encodeURIComponent(cleanup.workflowInstanceId)}`,
    },
  });
}
