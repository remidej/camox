import { projectIdSchema } from "@camox/api-contract/ids";
import type { ProjectSetupStep } from "@camox/api-contract/projects";
import { CIWorkflow } from "@cloudflare/ci";
import type { CiContext, CiParams, CloudflareArtifacts } from "@cloudflare/ci";
import type { CiBindings, RunnerOptions } from "@cloudflare/ci/worker";
import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";

import { createDb, type Database } from "../../db";
import { HOSTED_BUILD } from "../../lib/hosted-build";
import type { Bindings } from "../../types";
import { drafts } from "../drafts/schema";
import { projects } from "../projects/schema";
import { deletePublishScripts, liveScriptOf } from "../publishes/scripts";
import { sendReleaseFailureAlert } from "./alert";
import { camoxVersionInLockfile } from "./lockfile";
import { releases, type ReleaseStep } from "./schema";

const MAIN = "refs/heads/main";

/** A few quick retries: a copy of `main` that can't refresh mustn't hold up the release. */
const REFRESH_RETRIES: WorkflowStepConfig = {
  retries: { limit: 2, delay: "1 second", backoff: "constant" },
};

/**
 * Merges build their drafts' trees, so they get a build's time. Each draft retries what fails on
 * Camox's side, so the step tries once more, for the drafts that didn't merge.
 */
const MERGES: WorkflowStepConfig = {
  retries: { limit: 1, delay: "10 seconds", backoff: "constant" },
  timeout: "30 minutes",
};

/** A few retries for deleting the publishes' Workers, which the next release does otherwise. */
const RELEASE_CLEANUP_RETRIES: WorkflowStepConfig = {
  retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
};

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
    try {
      await this.release(event, step, ci);
    } finally {
      // Once the release deployed, or found nothing to release: a publish waiting for its
      // draft's merge revision then ships it over this release, never under it.
      await step
        .do("merge main into the drafts with code", MERGES, () =>
          mergeIntoDrafts(this.env, push.repo, push.sha),
        )
        .catch((error: unknown) => console.error("Main wasn't merged into the drafts", error));
    }
  }

  private async release(
    event: WorkflowEvent<CiParams<CloudflareArtifacts>>,
    step: WorkflowStep,
    ci: CiContext,
  ) {
    const push = event.payload;
    const db = createDb(this.env.DB);

    // The agent reads the code `main` now has. A copy that couldn't refresh doesn't hold up the
    // release: it stays on the commit it has until the next push.
    await step
      .do("refresh the copy of main the agent reads", REFRESH_RETRIES, () =>
        this.env.PROJECT_CODE.getByName(push.repo).refresh(push.sha),
      )
      .catch((error: unknown) => console.error("The agent's copy of main didn't refresh", error));

    const started = await step.do("record the release", async () => {
      const project = await db
        .select({ id: projects.id, name: projects.name, status: projects.status })
        .from(projects)
        .where(eq(projects.uuid, push.repo))
        .get();
      // A deleted project's repo, which its cleanup hasn't removed yet.
      if (!project) return null;
      const { tree, camoxVersion } = await this.readCommit(push.repo, push.sha);
      // Live already serves this tree, such as when a publish with code pushes the tree it put
      // on Live: there's nothing to release. Restarting an instance still re-runs its release.
      if ((await servedTree(db, project.id, event.instanceId)) === tree) return null;
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
          tree,
          camoxVersion,
          workflowInstanceId: event.instanceId,
          ...running,
        })
        // A restarted instance keeps its ID: re-running a release starts its row over.
        .onConflictDoUpdate({ target: releases.workflowInstanceId, set: { tree, ...running } });
      // Until a release succeeds, the project's setup follows its releases, including a re-run
      // of a first release that failed.
      const settingUp = project.status !== "live";
      if (settingUp) await followSetup(db, project.id, { status: "settingUp", setupStep: "build" });
      // `projectId` is the project's row id, not its Project ID (`push.repo`).
      return {
        projectId: project.id,
        projectName: project.name,
        settingUp: settingUp as boolean | undefined,
      };
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
        env: {
          CAMOX_DEPLOY_TOKEN: await deployToken(db, started.projectId),
          // Code that breaks a hosted check fails the build, so Live keeps its release.
          ...HOSTED_BUILD,
        },
      }));
      // A project deleted during its release stops it quietly, before it deploys a Worker its
      // cleanup may already have deleted. A deletion during the deploy can still race it.
      const exists = await step.do("check the project still exists", () =>
        projectExists(db, started.projectId),
      );
      if (!exists) return;
      if (started.settingUp) {
        await step.do("follow the setup to serving", () =>
          followSetup(db, started.projectId, { status: "settingUp", setupStep: "serve" }),
        );
      }
      // A publish's own Worker may serve the website (../publishes/scripts.ts).
      const publishServing = await step.do("read the Worker Live serves", () =>
        liveScriptOf(db, started.projectId),
      );
      await run(released, "deploy", async () => ({
        // Named after the repo, so a project's code can only ever replace its own Worker.
        command: `pnpm exec wrangler deploy --dispatch-namespace production --name ${push.repo}`,
        cloudflareCredentials: { accountId: this.env.CLOUDFLARE_ACCOUNT_ID },
      }));
      // The release's Worker serves from now on, unless a publish moved Live meanwhile.
      const served = await step.do("serve the release's Worker", () =>
        servePublishedOver(db, started.projectId, publishServing),
      );
      if (served) {
        // Nothing serves the publishes' Workers, nor rolls back to them, anymore. Dispatch serves
        // the release's Worker for any it still sends a request to. One left behind is deleted
        // by the next release.
        await step
          .do("delete the publishes' Workers", RELEASE_CLEANUP_RETRIES, () =>
            deletePublishScripts(this.env, push.repo),
          )
          .catch((error: unknown) => console.error("Publishes' Workers weren't deleted", error));
      }
    } catch (error) {
      const failedStep = current;
      // Reached only once a step has given up for good. Neither recording the failure nor
      // alerting stops the other or hides why the release failed. Nothing touches the deployed
      // Worker: the previous code keeps serving.
      await step
        .do("record the failed release", async () => {
          await end(db, event.instanceId, { status: "failed", failedStep });
          // A first release that gives up fails the project's setup: its page says so.
          if (started.settingUp) {
            await followSetup(db, started.projectId, {
              status: "setupFailed",
              setupStep: SETUP_STEPS[failedStep],
            });
          }
        })
        .catch((recordError: unknown) => console.error("Failed release not recorded", recordError));
      // Its own step, so that a retry of a later step or a replay of the instance doesn't send
      // it again. A step can still run more than once, so the alert can, rarely, go out twice.
      // Nobody is alerted about a project deleted during its release.
      await step
        .do("alert the failed release", async () => {
          if (!(await projectExists(db, started.projectId))) return;
          await sendReleaseFailureAlert(this.env, {
            project: {
              projectId: push.repo,
              name: started.projectName,
            },
            commit: push.sha,
            failedStep,
            workflowInstanceId: event.instanceId,
          });
        })
        .catch((alertError: unknown) =>
          console.error("Release failure alert not sent", alertError),
        );
      throw error;
    }
    await step.do("record the succeeded release", async () => {
      await end(db, event.instanceId, { status: "succeeded" });
      if (started.settingUp) {
        await followSetup(db, started.projectId, { status: "live", setupStep: null });
      }
    });
  }

  /** The commit's tree, and the `camox` version its `pnpm-lock.yaml` installs. */
  private async readCommit(repoName: string, commit: string) {
    using repo = await this.env.ARTIFACTS.get(repoName);
    const read = await repo.readCommit(commit);
    if (!read) throw new Error(`The pushed commit ${commit} isn't in ${repoName}.`);
    const lockfile = await repo.readFile({ ref: commit, path: "pnpm-lock.yaml" });
    return {
      tree: read.treeHash,
      camoxVersion: lockfile ? camoxVersionInLockfile(await lockfile.text()) : null,
    };
  }
}

/**
 * Merges the `main` pushed into every open draft with code of the project `projectUuid`, each in
 * its thread, which merges right away when its agent is idle, or after its turn otherwise. A
 * draft that can't merge doesn't hold up the others. A `main` that moved on since `commit` is
 * left to the release of the push that moved it, which merges once that release ended.
 */
async function mergeIntoDrafts(env: Bindings, projectUuid: string, commit: string) {
  using repo = await env.ARTIFACTS.get(projectUuid);
  const [main] = await repo.log({ ref: "main", limit: 1 });
  if (main?.hash !== commit) return;
  const open = await createDb(env.DB)
    .select({ id: drafts.id, threadId: drafts.threadId })
    .from(drafts)
    .innerJoin(projects, eq(projects.id, drafts.projectId))
    .where(
      and(eq(projects.uuid, projectUuid), eq(drafts.kind, "regular"), isNotNull(drafts.threadId)),
    );
  const merges = await Promise.allSettled(
    open.map(async ({ id, threadId }) => {
      if (!(await env.DRAFT_CODE.getByName(id).held())) return "noCode";
      return env.THREAD.getByName(threadId!).mergeMain();
    }),
  );
  const failed = merges.flatMap((merge) => (merge.status === "rejected" ? [merge.reason] : []));
  if (failed.length > 0) {
    throw new AggregateError(failed, `${failed.length} draft(s) didn't merge Live's code`);
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

/**
 * The tree Live serves: its last succeeded release's, other than `instanceId`'s. Null when no
 * release recorded one.
 */
async function servedTree(db: Database, projectId: number, instanceId: string) {
  const served = await db
    .select({ tree: releases.tree })
    .from(releases)
    .where(
      and(
        eq(releases.projectId, projectId),
        eq(releases.status, "succeeded"),
        ne(releases.workflowInstanceId, instanceId),
      ),
    )
    .orderBy(desc(releases.endedAt), desc(releases.id))
    .get();
  return served?.tree ?? null;
}

/**
 * Points Live back at the project's Worker the release deployed, from the publish's Worker that
 * served before the deploy, `publishServing`. False when a publish moved Live meanwhile: its
 * Worker keeps serving.
 */
async function servePublishedOver(db: Database, projectId: number, publishServing: string | null) {
  if (publishServing === null) return (await liveScriptOf(db, projectId)) === null;
  const cleared = await db
    .update(projects)
    .set({ liveScript: null })
    .where(and(eq(projects.id, projectId), eq(projects.liveScript, publishServing)))
    .returning({ id: projects.id });
  return cleared.length > 0 || (await liveScriptOf(db, projectId)) === null;
}

/** Whether the project, by its row id, hasn't been deleted. */
async function projectExists(db: Database, projectId: number) {
  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  return project !== undefined;
}

/** The setup step each release step belongs to, as the project's page names them. */
const SETUP_STEPS: Record<ReleaseStep, ProjectSetupStep> = {
  install: "build",
  release: "build",
  deploy: "serve",
};

/** Moves a project that isn't live yet along its setup. A live project stays live. */
async function followSetup(
  db: Database,
  projectId: number,
  setup: Pick<typeof projects.$inferInsert, "status" | "setupStep">,
) {
  await db
    .update(projects)
    .set(setup)
    .where(and(eq(projects.id, projectId), ne(projects.status, "live")));
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
