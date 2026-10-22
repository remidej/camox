import {
  type AlertProject,
  sendAlert,
  workflowInstanceUrl,
  workflowLink,
} from "../../lib/alert-email";
import type { Bindings } from "../../types";
import type { UpgradeStep } from "./project-workflow";

/** The Workflows' names, as `workflows` in wrangler.jsonc declares them. */
const UPGRADE_WORKFLOW_NAME = "camox-upgrade";
const PROJECT_UPGRADE_WORKFLOW_NAME = "camox-project-upgrade";

export type FailedUpgrade = {
  project: AlertProject;
  /** The project's upgrade, where its logs are, if it started. */
  instanceId: string | null;
  /**
   * The step that gave up; `unfinished` for an upgrade that ended some other way, such as by being
   * terminated; or `unreadable` for a repo that couldn't be read or has no `main`.
   */
  failure: UpgradeStep | "unfinished" | "unreadable";
};

function describe(failure: FailedUpgrade["failure"]) {
  if (failure === "unfinished") return "didn't finish";
  if (failure === "unreadable") return "whose repo couldn't be read";
  return `failed at its ${failure} step`;
}

/**
 * Emails the alerts address the projects an upgrade couldn't move to the new SDK, each with a
 * link to its logs. They keep serving their previous release until Rémi fixes them by hand.
 */
export function sendUpgradeFailureAlert(
  env: Bindings,
  upgrade: { camoxVersion: string; failed: FailedUpgrade[]; workflowInstanceId: string },
): Promise<void> {
  const count = upgrade.failed.length;
  const projectsLabel = count === 1 ? "1 project" : `${count} projects`;
  return sendAlert(env, {
    subject: `Upgrade to Camox ${upgrade.camoxVersion}: ${projectsLabel} didn't build`,
    failure: `${projectsLabel} couldn't be upgraded to Camox ${upgrade.camoxVersion}, so nothing was pushed to their main branch. They keep serving their previous release.`,
    details: upgrade.failed.map(({ project, instanceId, failure }) => ({
      label: project.name,
      value: `${project.projectId}, ${describe(failure)}`,
      url:
        instanceId === null
          ? undefined
          : workflowInstanceUrl(
              env.CLOUDFLARE_ACCOUNT_ID,
              PROJECT_UPGRADE_WORKFLOW_NAME,
              instanceId,
            ),
    })),
    link: {
      ...workflowLink(env, UPGRADE_WORKFLOW_NAME, upgrade.workflowInstanceId),
      label: "Open the upgrade",
    },
  });
}
