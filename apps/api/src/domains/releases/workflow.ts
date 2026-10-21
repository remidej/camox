import { CIWorkflow } from "@cloudflare/ci";
import type { CiContext, CiParams, CloudflareArtifacts } from "@cloudflare/ci";
import type { CiBindings } from "@cloudflare/ci/worker";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";

import { createDb } from "../../db";
import type { Bindings } from "../../types";
import { projects } from "../projects/schema";
import { camoxVersionInLockfile } from "./lockfile";
import { releases, type ReleaseStep } from "./schema";

const MAIN = "refs/heads/main";

// A Project ID: the lowercase UUID each project's repo and Worker are named after. Other repos
// in the namespace, such as `template-default`, aren't released. It also keeps the deploy's
// `--name` safe to put in a command.
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// `@cloudflare/ci` types every binding its examples have, but the Workflow only reads `ARTIFACTS`,
// `SANDBOX`, `BACKUP_BUCKET`, `CLOUDFLARE_ACCOUNT_ID` and `CF_TOKEN`. `CI_WORKFLOW` (this Worker
// binds `RELEASE_WORKFLOW`) and the R2 keys (the release sandbox Worker's) aren't here.
type ReleaseEnv = Bindings & CiBindings;

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
    if (push.ref !== MAIN || !PROJECT_ID.test(push.repo)) return;
    const db = createDb(this.env.DB);

    const started = await step.do("record the release", async () => {
      const project = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.uuid, push.repo))
        .get();
      // A deleted project's repo, which its cleanup hasn't removed yet.
      if (!project) return null;
      const camoxVersion = await this.camoxVersion(push.repo, push.sha);
      await db
        .insert(releases)
        .values({
          projectId: project.id,
          commit: push.sha,
          camoxVersion,
          status: "running",
          workflowInstanceId: event.instanceId,
          startedAt: Date.now(),
        })
        .onConflictDoNothing({ target: releases.workflowInstanceId });
      return { projectId: project.id };
    });
    if (!started) return;

    // Read outside any step, so the token never lands in a step's output, which the Workflow
    // keeps and shows. The step that needs it gets it through its environment alone.
    const project = await db
      .select({ deployToken: projects.deployToken })
      .from(projects)
      .where(eq(projects.id, started.projectId))
      .get();

    let current: ReleaseStep = "install";
    try {
      const installed = await ci.runner({
        name: "install",
        command: "pnpm install --frozen-lockfile",
        cache: { inputs: ["pnpm-lock.yaml"] },
      });
      current = "release";
      const released = await installed.runner({
        name: "release",
        command: "pnpm exec camox release",
        env: { CAMOX_DEPLOY_TOKEN: project?.deployToken ?? "" },
      });
      current = "deploy";
      await released.runner({
        name: "deploy",
        // Named after the repo, so a project's code can only ever replace its own Worker.
        command: `pnpm exec wrangler deploy --dispatch-namespace production --name ${push.repo}`,
        cloudflareCredentials: { accountId: this.env.CLOUDFLARE_ACCOUNT_ID },
      });
    } catch (error) {
      const failedStep = current;
      await step.do("record the failed release", () =>
        this.end(event.instanceId, { status: "failed", failedStep }),
      );
      throw error;
    }
    await step.do("record the succeeded release", () =>
      this.end(event.instanceId, { status: "succeeded" }),
    );
  }

  private async camoxVersion(repoName: string, commit: string) {
    using repo = await this.env.ARTIFACTS.get(repoName);
    const lockfile = await repo.readFile({ ref: commit, path: "pnpm-lock.yaml" });
    return lockfile ? camoxVersionInLockfile(await lockfile.text()) : null;
  }

  private async end(
    workflowInstanceId: string,
    outcome: { status: "succeeded" } | { status: "failed"; failedStep: ReleaseStep },
  ) {
    await createDb(this.env.DB)
      .update(releases)
      .set({ ...outcome, endedAt: Date.now() })
      .where(
        and(eq(releases.workflowInstanceId, workflowInstanceId), eq(releases.status, "running")),
      );
  }
}
