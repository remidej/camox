import { projectIdSchema } from "@camox/api-contract/ids";
import { CIWorkflow } from "@cloudflare/ci";
import type { CiContext, CiParams, CloudflareArtifacts } from "@cloudflare/ci";
import type { CiBindings, RunnerOptions } from "@cloudflare/ci/worker";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";

import { createDb, type Database } from "../../db";
import type { Bindings } from "../../types";
import { projects } from "../projects/schema";
import { sendReleaseFailureAlert } from "./alert";
import { camoxVersionInLockfile } from "./lockfile";
import { releases, type ReleaseStep } from "./schema";

const MAIN = "refs/heads/main";

// `@cloudflare/ci` types every binding its examples have, but the Workflow only reads `ARTIFACTS`,
// `SANDBOX`, `BACKUP_BUCKET`, `CLOUDFLARE_ACCOUNT_ID` and `CF_TOKEN`. `CI_WORKFLOW` (this Worker
// binds `RELEASE_WORKFLOW`), `BACKUP_BUCKET_NAME` and the R2 keys (the release sandbox Worker's)
// aren't here.
type ReleaseEnv = Bindings & CiBindings;

type Runs = Pick<CiContext, "runner">;

/**
 * A release: what a push to a project's `main` starts (GLOSSARY.md). Cloudflare Artifacts'
 * `cf.artifacts.repo.pushed` event starts it for every repo in the `projects` namespace. Each
 * step runs in its own sandbox through `@cloudflare/ci`, on the previous step's workspace, and
 * can be retried, so each one is idempotent: installing from a frozen lockfile, syncing the same
 * Definition Set to Live, and deploying the same Worker again.
 */
export class ReleaseWorkflow extends CIWorkflow<CloudflareArtifacts, ReleaseEnv> {
  protected async pipeline(
    event: WorkflowEvent<CiParams<CloudflareArtifacts>>,
    step: WorkflowStep,
    ci: CiContext,
  ) {
    const push = event.payload;
    // Only a Project ID names a project's repo and Worker. Other repos in the namespace, such as
    // `template-default`, aren't released, and the deploy's `--name` is safe in a command.
    if (push.ref !== MAIN || !projectIdSchema.safeParse(push.repo).success) return;
    const db = createDb(this.env.DB);

    const started = await step.do("record the release", async () => {
      const project = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.uuid, push.repo))
        .get();
      // A deleted project's repo, which its cleanup hasn't removed yet.
      if (!project) return null;
      const camoxVersion = await this.camoxVersion(push.repo, push.sha);
      const running = {
        status: "running" as const,
        failedStep: null,
        startedAt: Date.now(),
        endedAt: null,
      };
      await db
        .insert(releases)
        .values({
          projectId: project.id,
          commit: push.sha,
          camoxVersion,
          workflowInstanceId: event.instanceId,
          ...running,
        })
        // A restarted instance keeps its ID: re-running a release starts its row over.
        .onConflictDoUpdate({ target: releases.workflowInstanceId, set: running });
      // `projectId` is the project's row id, not its Project ID (`push.repo`).
      return { projectId: project.id, projectName: project.name as string | undefined };
    });
    if (!started) return;

    // The step that gave up, set as each one starts.
    let current: ReleaseStep = "install";
    const run = async (
      from: Runs,
      name: ReleaseStep,
      options: () => Promise<Omit<RunnerOptions, "name">>,
    ) => {
      current = name;
      return from.runner({ name, ...(await options()) });
    };

    try {
      const installed = await run(ci, "install", async () => ({
        command: "pnpm install --frozen-lockfile",
        cache: { inputs: ["pnpm-lock.yaml"] },
      }));
      const released = await run(installed, "release", async () => ({
        command: "pnpm exec camox release",
        env: { CAMOX_DEPLOY_TOKEN: await deployToken(db, started.projectId) },
      }));
      await run(released, "deploy", async () => ({
        // Named after the repo, so a project's code can only ever replace its own Worker.
        command: `pnpm exec wrangler deploy --dispatch-namespace production --name ${push.repo}`,
        cloudflareCredentials: { accountId: this.env.CLOUDFLARE_ACCOUNT_ID },
      }));
    } catch (error) {
      const failedStep = current;
      // Reached only once a step has given up for good. Neither recording the failure nor
      // alerting stops the other or hides why the release failed. Nothing touches the deployed
      // Worker: the previous code keeps serving.
      await step
        .do("record the failed release", () =>
          end(db, event.instanceId, { status: "failed", failedStep }),
        )
        .catch((recordError: unknown) => console.error("Failed release not recorded", recordError));
      // Its own step, so that a retry of a later step or a replay of the instance doesn't send
      // it again. A step can still run more than once, so the alert can, rarely, go out twice.
      await step
        .do("alert the failed release", () =>
          sendReleaseFailureAlert(this.env, {
            project: {
              projectId: push.repo,
              // An instance started before the name was recorded replays an output without it.
              name: started.projectName ?? push.repo,
            },
            commit: push.sha,
            failedStep,
            workflowInstanceId: event.instanceId,
          }),
        )
        .catch((alertError: unknown) =>
          console.error("Release failure alert not sent", alertError),
        );
      throw error;
    }
    await step.do("record the succeeded release", () =>
      end(db, event.instanceId, { status: "succeeded" }),
    );
  }

  private async camoxVersion(repoName: string, commit: string) {
    using repo = await this.env.ARTIFACTS.get(repoName);
    const lockfile = await repo.readFile({ ref: commit, path: "pnpm-lock.yaml" });
    return lockfile ? camoxVersionInLockfile(await lockfile.text()) : null;
  }
}

/**
 * Read outside any step, so the token never lands in a step's output, which the Workflow keeps
 * and shows. The step that needs it gets it through its environment alone.
 */
async function deployToken(db: Database, projectId: number) {
  const project = await db
    .select({ deployToken: projects.deployToken })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) throw new Error("The project was deleted during its release.");
  return project.deployToken;
}

async function end(
  db: Database,
  workflowInstanceId: string,
  outcome: { status: "succeeded" } | { status: "failed"; failedStep: ReleaseStep },
) {
  await db
    .update(releases)
    .set({ failedStep: null, ...outcome, endedAt: Date.now() })
    .where(
      and(eq(releases.workflowInstanceId, workflowInstanceId), eq(releases.status, "running")),
    );
}
