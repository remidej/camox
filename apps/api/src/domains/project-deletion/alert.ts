import { type AlertProject, projectDetails, sendAlert, workflowLink } from "../../lib/alert-email";
import type { Bindings } from "../../types";

/** The deletion Workflow's name, as `workflows` in wrangler.jsonc declares it. */
const DELETION_WORKFLOW_NAME = "camox-project-deletion";

export type FailedCleanup = {
  /** The deleted project: its row is gone. */
  project: AlertProject;
  /** The steps that gave up, as the alert names them, such as "Deleting the Worker". */
  failedSteps: string[];
  /** What the failed steps leave on Cloudflare, such as "Worker <Project ID>". */
  leftBehind: string[];
  /** The deletion Workflow's instance that gave up, or null when it couldn't be started. */
  workflowInstanceId: string | null;
};

/** Emails the alerts address that a deleted project's cleanup gave up, leaving resources behind. */
export function sendCleanupFailureAlert(env: Bindings, cleanup: FailedCleanup): Promise<void> {
  const { name } = cleanup.project;
  return sendAlert(env, {
    subject: `Cleanup failed: ${name}`,
    failure: `Cleaning up the deleted project ${name} failed. Its site is offline, but what the failed steps delete is still on Cloudflare.`,
    details: [
      ...projectDetails(cleanup.project),
      { label: "Failed step", value: cleanup.failedSteps.join(", ") },
      { label: "Left behind", value: cleanup.leftBehind.join(", ") },
    ],
    link: workflowLink(env, DELETION_WORKFLOW_NAME, cleanup.workflowInstanceId),
  });
}
