import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import type { Bindings } from "../../types";
import { destroyPublishSandbox } from "../publishes/sandbox";
import { deleteProjectBuilds } from "../revisions/archive";
import { destroySandbox } from "../revisions/sandbox";
import { sendCleanupFailureAlert } from "./alert";

export type ProjectDeletionParams = {
  /** The deleted project's Project ID, which names its Worker and its repo. */
  projectId: string;
  /** The deleted project's name, for the alert: its row is gone. */
  name: string;
  /** Its drafts' IDs, which name their working copies and sandboxes: their rows are gone. */
  drafts?: string[];
};

/** The dispatch namespace every project's Worker is deployed to (../releases/README.md). */
const DISPATCH_NAMESPACE = "production";

/** The statuses of a Workflow instance that hasn't ended. */
const UNDERWAY = new Set<InstanceStatus["status"]>([
  "queued",
  "running",
  "paused",
  "waiting",
  "waitingForPause",
]);

/**
 * A deleted project's cleanup. Deleting the project removed its rows and its host, so its site is
 * already offline: this deletes what's left on Cloudflare, its Worker, its copies of its code and
 * its repo, named after its Project ID and its drafts' IDs. Workflows retry a failed step, and each step is done once what it deletes
 * is gone. Nothing is kept for recovery.
 *
 * A step that gives up doesn't stop the next one from cleaning up what it can. Once they've all
 * run, a cleanup with a failed step emails one alert to Camox's alerts address and fails.
 */
export class ProjectDeletionWorkflow extends WorkflowEntrypoint<Bindings, ProjectDeletionParams> {
  async run(event: WorkflowEvent<ProjectDeletionParams>, step: WorkflowStep) {
    const { projectId, name, drafts = [] } = event.payload;
    const failures: { step: string; leftBehind: string; error: unknown }[] = [];
    const attempt = async (
      label: string,
      leftBehind: string,
      stepName: string,
      work: () => Promise<unknown>,
    ) => {
      try {
        await step.do(stepName, async () => {
          await work();
          return null;
        });
      } catch (error) {
        failures.push({ step: label, leftBehind, error });
      }
    };

    await attempt(
      "Stopping the setup",
      `creation Workflow instance ${projectId}`,
      "stop the setup",
      () => this.stopSetup(projectId),
    );
    await attempt("Deleting the Worker", `Worker ${projectId}`, "delete the Worker", () =>
      this.deleteWorker(projectId),
    );
    // Before the repo: a draft's working copy deletes its branch there.
    await attempt(
      "Deleting the code",
      `copies of the code, builds and sandboxes of project ${projectId}`,
      "delete the code",
      () => this.deleteCode(projectId, drafts),
    );
    // False when there's no repo: never forked, or deleted by an earlier attempt.
    await attempt("Deleting the repo", `repo ${projectId}`, "delete the repo", () =>
      this.env.ARTIFACTS.delete(projectId),
    );

    if (failures.length === 0) return;
    // Its own step, so that a replay of the instance doesn't send it again. A step can still run
    // more than once, so the alert can, rarely, go out twice.
    await step
      .do("alert the failed cleanup", () =>
        sendCleanupFailureAlert(this.env, {
          project: { projectId, name },
          failedSteps: failures.map((failure) => failure.step),
          leftBehind: failures.map((failure) => failure.leftBehind),
          workflowInstanceId: event.instanceId,
        }),
      )
      .catch((alertError: unknown) => console.error("Cleanup failure alert not sent", alertError));
    throw failures[0]!.error;
  }

  /**
   * Terminates the project's creation Workflow, named after its Project ID, if it's still
   * underway: a retried fork would otherwise make its repo again once this deleted it.
   */
  private async stopSetup(projectId: string) {
    let setup: WorkflowInstance;
    try {
      setup = await this.env.PROJECT_CREATION_WORKFLOW.get(projectId);
    } catch (error) {
      // A project created before the creation Workflow existed.
      if (error instanceof Error && /not[_ ]found/i.test(error.message)) return;
      throw error;
    }
    const { status } = await setup.status();
    if (UNDERWAY.has(status)) await setup.terminate();
  }

  /**
   * Deletes the project's copies of its code: its copy of `main`, its drafts' working copies and
   * revision sandboxes, its builds in R2 and its publish sandbox.
   */
  private async deleteCode(projectId: string, drafts: string[]) {
    for (const draftId of drafts) {
      await this.env.DRAFT_CODE.getByName(draftId).discard();
      await destroySandbox(this.env, draftId);
    }
    await this.env.PROJECT_CODE.getByName(projectId).discard();
    await deleteProjectBuilds(this.env, projectId);
    await destroyPublishSandbox(this.env, projectId);
  }

  /** Deletes the project's Worker from the dispatch namespace, if it was ever deployed. */
  private async deleteWorker(projectId: string) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.env.CLOUDFLARE_ACCOUNT_ID}/workers/dispatch/namespaces/${DISPATCH_NAMESPACE}/scripts/${encodeURIComponent(projectId)}?force=true`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: { authorization: `Bearer ${this.env.CF_TOKEN}` },
    });
    // Never deployed, or deleted by an earlier attempt.
    if (response.ok || response.status === 404) return;
    throw new Error(`Deleting the Worker answered ${response.status}: ${await response.text()}`);
  }
}
