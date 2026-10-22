import { CIWorkflow } from "@cloudflare/ci";
import type { CiContext, CiParams, CloudflareArtifacts } from "@cloudflare/ci";
import type { CiBindings, RunnerOptions } from "@cloudflare/ci/worker";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { Bindings } from "../../types";

type UpgradeEnv = Bindings & CiBindings;

/** The steps of a project's upgrade that run in a sandbox, in order. */
export type UpgradeStep = "bump" | "build" | "push";

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

const AUTHOR = { name: "Camox", email: "upgrades@camox.dev" };

/** Matches the `camox` package and Camox's scoped ones, such as `@camox/ui`. */
const CAMOX_PACKAGE = /^(camox|@camox\/[a-z0-9-]+)$/;

/**
 * One project's move to a new SDK, started by the upgrade Workflow (`workflow.ts`) on the commit
 * its `main` points to. In sandboxes, through `@cloudflare/ci`, it bumps the Camox packages,
 * builds as a release would without syncing anything, then commits the bumped `package.json` and
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

    let current: UpgradeStep = "bump";
    const run = async (
      from: Pick<CiContext, "runner">,
      name: UpgradeStep,
      options: () => Promise<Omit<RunnerOptions, "name">>,
    ) => {
      current = name;
      return from.runner({ name, ...(await options()) });
    };

    try {
      const bumped = await run(ci, "bump", async () => ({
        command: `${await step.do("read the Camox packages", () => bumpCommand(this.env, params))} && pnpm install --no-frozen-lockfile`,
      }));
      const built = await run(bumped, "build", async () => ({
        command: "pnpm exec camox release --dry-run",
      }));
      await run(built, "push", async () => ({
        command: pushCommand(params.sha, camoxVersion),
        env: await pushEnv(this.env, params.repo, event.timestamp),
      }));
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
 * Sets every Camox package the project depends on to the new version, in the section it's in.
 * Only `package.json` changes; the install that follows updates the lockfile.
 */
async function bumpCommand(env: Bindings, params: ProjectUpgradeParams) {
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
 * Commits the bumped `package.json` and lockfile on top of the commit the upgrade built, and
 * pushes it to `main`. The workspace has no `.git`, so the step fetches that commit first. Its
 * author and dates are fixed, so a retried push makes the same commit and pushes nothing new. A
 * `main` that moved since is refused, rather than overwritten.
 */
function pushCommand(sha: string, camoxVersion: string) {
  return [
    "git init -q",
    'git remote add origin "$UPGRADE_GIT_REMOTE"',
    `git fetch -q --depth=1 origin ${sha}`,
    "git reset -q FETCH_HEAD",
    "git add package.json pnpm-lock.yaml",
    `git commit -q -m "Upgrade Camox to ${camoxVersion}"`,
    "git push -q origin HEAD:refs/heads/main",
  ].join(" && ");
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
