import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";

import { createDb, type Database } from "../../db";
import type { Bindings } from "../../types";
import { projects } from "../projects/schema";
import { sendSetupFailureAlert } from "./alert";
import { copyTemplate } from "./copy";

export type ProjectCreationParams = {
  /** The new project's Project ID, which names its repo. */
  projectId: string;
};

/** The repo every new project's code starts as a fork of (packages/cli/scripts/README.md). */
const TEMPLATE_REPO = "template-default";

/**
 * A new project's setup, up to its first release: it forks `template-default` into the project's
 * repo, named after its Project ID, then commits the copy named after the project and pushes it
 * to `main`, which starts the first release. Workflows retry a failed step, and a step whose work
 * landed may have failed after it, so each step first checks whether its work is done.
 *
 * Nothing is undone when it gives up: the project is marked `setupFailed`, Camox's alerts address
 * is emailed, and the instance is re-run once the cause is fixed.
 */
export class ProjectCreationWorkflow extends WorkflowEntrypoint<Bindings, ProjectCreationParams> {
  async run(event: WorkflowEvent<ProjectCreationParams>, step: WorkflowStep) {
    const { projectId } = event.payload;
    const db = createDb(this.env.DB);

    try {
      await step.do("fork the Template", async () => {
        using template = await this.env.ARTIFACTS.get(TEMPLATE_REPO);
        try {
          await template.fork(projectId, { defaultBranchOnly: true });
        } catch (error) {
          // An earlier attempt's fork landed, though its response didn't.
          if (!isArtifactsError(error, "ALREADY_EXISTS")) throw error;
        }
        return null;
      });

      await step.do("commit the project's code", async () => {
        const project = await db
          .select({ name: projects.name, slug: projects.slug })
          .from(projects)
          .where(eq(projects.uuid, projectId))
          .get();
        // Deleted while it was being set up.
        if (!project) return null;
        // Throws FORK_IN_PROGRESS while the fork runs, which retries the step.
        using repo = await this.env.ARTIFACTS.get(projectId);
        await copyTemplate(repo, { projectId, ...project });
        return null;
      });
    } catch (error) {
      // Reached once a step has given up for good. Neither recording the failure nor alerting
      // stops the other or hides why the setup failed.
      await step
        .do("record the failed setup", () => setupFailed(db, projectId))
        .catch((recordError: unknown) => console.error("Failed setup not recorded", recordError));
      await step
        .do("alert the failed setup", async () => {
          const project = await db
            .select({ name: projects.name })
            .from(projects)
            .where(eq(projects.uuid, projectId))
            .get();
          await sendSetupFailureAlert(this.env, {
            project: { projectId, name: project?.name ?? projectId },
            failedStep: "copyTemplate",
            workflowInstanceId: event.instanceId,
          });
        })
        .catch((alertError: unknown) => console.error("Setup failure alert not sent", alertError));
      throw error;
    }

    // The push starts the first release, which builds the project next.
    await step.do("follow the setup to building", () =>
      db
        .update(projects)
        .set({ setupStep: "build" })
        .where(
          and(
            eq(projects.uuid, projectId),
            eq(projects.status, "settingUp"),
            eq(projects.setupStep, "copyTemplate"),
          ),
        )
        .then(() => null),
    );
  }
}

async function setupFailed(db: Database, projectId: string) {
  await db
    .update(projects)
    .set({ status: "setupFailed", setupStep: "copyTemplate" })
    .where(and(eq(projects.uuid, projectId), eq(projects.status, "settingUp")));
}

/**
 * Whether the Artifacts binding threw `code`, such as `ALREADY_EXISTS`. An `ArtifactsError` that
 * crossed an RPC boundary keeps its code only in its message.
 */
export function isArtifactsError(error: unknown, code: ArtifactsErrorCode): boolean {
  if (!(error instanceof Error)) return false;
  if ((error as { code?: unknown }).code === code) return true;
  return new RegExp(`\\b${code}\\b`).test(error.message);
}
