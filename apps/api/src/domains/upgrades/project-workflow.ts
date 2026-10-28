import { CIWorkflow } from "@cloudflare/ci";
import type { CiContext, CiParams, CloudflareArtifacts } from "@cloudflare/ci";
import type { CiBindings, DirectoryBackup, RunnerOptions } from "@cloudflare/ci/worker";
import { getSandbox } from "@cloudflare/sandbox";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import { createDb, type Database } from "../../db";
import { HOSTED_BUILD } from "../../lib/hosted-build";
import type { Bindings } from "../../types";
import { leaveUpgradePush, queueUpgradePush, turnOf } from "../publishes/queue";
import { ENSURE_SDK_BUNDLE, ensureSdkBundle, type SdkBundleSource } from "../sdk-bundles/ensure";
import { UPGRADED_FILES, buildCommand, pushCommand, updateCommand } from "./commands";

type UpgradeEnv = Bindings & CiBindings;

/** The steps of a project's upgrade that run in a sandbox, in order. */
export type UpgradeStep = "update" | "build" | "push";

/** What the upgrade Workflow starts a project's upgrade with. */
export type ProjectUpgradeParams = CiParams<CloudflareArtifacts> & {
  /** The published `camox` version to move to. Validated by the upgrade Workflow. */
  camoxVersion: string;
  /** The upgrade Workflow's instance, which waits to hear how this one ended. */
  upgradeInstanceId: string;
};

/**
 * How a project's upgrade ended, as it tells the upgrade Workflow: upgraded, or not, with the
 * step that gave up, or null when it ended some other way, such as by being terminated.
 */
export type ProjectUpgradeOutcome =
  | { upgraded: true }
  | { upgraded: false; failedStep: UpgradeStep | null };

/** The event a project's upgrade sends the upgrade Workflow when it ends. */
export function upgradeEndedEvent(projectId: string) {
  return `project-upgrade-ended-${projectId}`;
}

const AUTHOR = { name: "Camox", email: "upgrades@camox.ai" };

/**
 * How often an upgrade ready to push checks again whether a publish with code still runs in its
 * project. A tuning value.
 */
export const PUBLISHES_CHECKED_EVERY = "3 seconds";

/** Matches the `camox` package and Camox's scoped ones, such as `@camox/ui`. */
const CAMOX_PACKAGE = /^(camox|@camox\/[a-z0-9-]+)$/;

/**
 * One project's move to a new SDK, started by the upgrade Workflow (`workflow.ts`) on the commit
 * its `main` points to. In sandboxes, through `@cloudflare/ci`, it moves the Camox packages to the new version,
 * builds as a release would without syncing anything, then commits the changed `package.json` and
 * lockfile and pushes them to `main`, which releases the project. Nothing else in the project
 * changes. A project that doesn't build isn't pushed, so it keeps serving its previous release.
 */
export class ProjectUpgradeWorkflow extends CIWorkflow<CloudflareArtifacts, UpgradeEnv> {
  protected async pipeline(
    event: WorkflowEvent<CiParams<CloudflareArtifacts>>,
    step: WorkflowStep,
    ci: CiContext,
  ) {
    const params = event.payload as ProjectUpgradeParams;
    const { camoxVersion } = params;

    let current: UpgradeStep = "update";
    const run = async (
      from: Pick<CiContext, "runner">,
      name: UpgradeStep,
      options: () => Promise<Omit<RunnerOptions, "name">>,
    ) => {
      current = name;
      return from.runner({ name, ...(await options()) });
    };

    try {
      const updated = await run(ci, "update", async () => ({
        command: updateCommand(
          await step.do("read the Camox packages", () => setVersionsCommand(this.env, params)),
        ),
      }));
      // The SDK Bundle the dry-run release builds against, from the lockfile the update resolved.
      current = "build";
      const upgraded = await step.do("read the upgraded lockfile", () =>
        upgradedFiles(this.env, updated.snapshot),
      );
      await step.do("ensure the SDK Bundle", ENSURE_SDK_BUNDLE, () =>
        ensureSdkBundle(this.env, upgraded),
      );
      const built = await run(updated, "build", async () => ({
        command: buildCommand(),
        // A new hosted check that the project's code breaks fails the Upgrade's build.
        env: { ...HOSTED_BUILD },
      }));
      // A publish with code serves its revision's build, then pushes its tree to `main`: an
      // upgrade pushed in between would release `main` without the draft's code over it, and the
      // publish's squashed commit would undo the upgrade. The push waits for its turn in the
      // project's queue of publishes with code, then lands on the `main` they pushed.
      const db = createDb(this.env.DB);
      const projectId = await step.do("join the project's queue of publishes with code", () =>
        queueUpgradePush(db, params.repo, event.instanceId),
      );
      try {
        if (projectId !== null) await waitForTurn(step, db, projectId, event.instanceId);
        await run(built, "push", async () => ({
          command: pushCommand(params.sha, camoxVersion),
          env: await pushEnv(this.env, params.repo, event.timestamp),
        }));
      } finally {
        if (projectId !== null) {
          await step
            .do("leave the project's queue of publishes with code", () =>
              leaveUpgradePush(this.env, db, projectId, event.instanceId),
            )
            .catch((error: unknown) => console.error("An upgrade didn't leave its queue", error));
        }
      }
    } catch (error) {
      const failedStep = current;
      await this.tell(step, params, { upgraded: false, failedStep });
      throw error;
    }
    await this.tell(step, params, { upgraded: true });
  }

  /** Tells the upgrade Workflow how this upgrade ended, so it can move on and report it. */
  private async tell(
    step: WorkflowStep,
    params: ProjectUpgradeParams,
    outcome: ProjectUpgradeOutcome,
  ) {
    await step
      .do("tell the upgrade how it ended", async () => {
        const upgrade = await this.env.UPGRADE_WORKFLOW.get(params.upgradeInstanceId);
        await upgrade.sendEvent({ type: upgradeEndedEvent(params.repo), payload: outcome });
      })
      // The upgrade Workflow stops waiting after a while, and then reads this instance's status.
      .catch((sendError: unknown) => console.error("Upgrade outcome not sent", sendError));
  }
}

/**
 * The `package.json` and lockfile the update step saved, read from its workspace snapshot in a
 * sandbox of their own: the SDK Bundle builds in one that never restored a website's workspace.
 */
async function upgradedFiles(env: UpgradeEnv, snapshot: DirectoryBackup): Promise<SdkBundleSource> {
  const sandbox = getSandbox(env.SANDBOX, `upgraded-files-${crypto.randomUUID()}`, {
    transport: "rpc",
    enableDefaultSession: false,
  });
  try {
    await sandbox.restoreBackup(snapshot);
    const read = async (file: string) =>
      (await sandbox.readFile(`${snapshot.dir}/${UPGRADED_FILES}/${file}`)).content;
    return { packageJson: await read("package.json"), lockfile: await read("pnpm-lock.yaml") };
  } finally {
    await sandbox.destroy().catch((error: unknown) => {
      console.error("An upgrade's sandbox wasn't destroyed", error);
    });
  }
}

/**
 * Waits until the upgrade's push is first in its project's queue: every publish with code asked
 * for before it landed or went back.
 */
async function waitForTurn(
  step: WorkflowStep,
  db: Database,
  projectId: number,
  instanceId: string,
) {
  for (let check = 1; ; check++) {
    const turn = await step.do(`check the project's queue (${check})`, () =>
      turnOf(db, projectId, instanceId),
    );
    if (turn !== "waiting") return;
    await step.sleep(`wait for publishes with code (${check})`, PUBLISHES_CHECKED_EVERY);
  }
}

/**
 * Sets every Camox package the project depends on to the new version, in the section it's in.
 * Only `package.json` changes; the install that follows updates the lockfile.
 */
async function setVersionsCommand(env: Bindings, params: ProjectUpgradeParams) {
  using repo = await env.ARTIFACTS.get(params.repo);
  const file = await repo.readFile({ ref: params.sha, path: "package.json" });
  if (!file) throw new Error("The project has no package.json.");
  const manifest = JSON.parse(await file.text()) as Record<string, unknown>;
  const settings = (["dependencies", "devDependencies"] as const).flatMap((section) =>
    Object.keys((manifest[section] as Record<string, string> | undefined) ?? {})
      .filter((name) => CAMOX_PACKAGE.test(name))
      .map((name) => `${section}.${name}=^${params.camoxVersion}`),
  );
  if (settings.length === 0) throw new Error("The project doesn't depend on camox.");
  return `npm pkg set ${settings.join(" ")}`;
}

/**
 * The push step's environment: the repo's remote, a write token for it, and the commit's
 * author and dates. Read outside any step, so the token never lands in a step's output.
 */
async function pushEnv(env: Bindings, repoName: string, startedAt: Date) {
  using repo = await env.ARTIFACTS.get(repoName);
  const [{ remote }, token] = await Promise.all([repo.info(), repo.createToken("write", 3600)]);
  const date = startedAt.toISOString();
  return {
    UPGRADE_GIT_REMOTE: remote,
    // Authenticates Git through its environment, so the token stays out of the command.
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token.plaintext}`,
    GIT_AUTHOR_NAME: AUTHOR.name,
    GIT_AUTHOR_EMAIL: AUTHOR.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: AUTHOR.name,
    GIT_COMMITTER_EMAIL: AUTHOR.email,
    GIT_COMMITTER_DATE: date,
  };
}
