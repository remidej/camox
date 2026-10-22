import type { CloudflareArtifacts } from "@cloudflare/ci";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { asc, eq } from "drizzle-orm";

import { createDb } from "../../db";
import type { Bindings } from "../../types";
import { projects } from "../projects/schema";
import { camoxVersionInLockfile } from "../releases/lockfile";
import { sendUpgradeFailureAlert, type FailedUpgrade } from "./alert";
import {
  upgradeEndedEvent,
  type ProjectUpgradeOutcome,
  type ProjectUpgradeParams,
} from "./project-workflow";

export type UpgradeParams = {
  /** The SDK version just published, such as `0.45.0`. */
  camoxVersion: string;
};

/**
 * How many projects upgrade at once. Each one that builds is pushed, and its release deploys its
 * Worker, which takes a dozen or so Cloudflare API requests. Cloudflare allows 1,200 requests per
 * 5 minutes per token, and Camox's deploy token is shared with every other release. A batch
 * starts at most once per `BATCH_WINDOW_MS`, and its releases deploy within minutes of its
 * pushes, so at most two batches' deploys share a window: a few hundred requests. It also keeps
 * the release sandbox Worker's containers free for the releases the pushes start.
 */
export const PROJECTS_PER_BATCH = 10;

/** Cloudflare's API rate limit window. */
const BATCH_WINDOW_MS = 5 * 60_000;

/** How long to wait for a project's upgrade before reading its status instead. */
const PROJECT_UPGRADE_TIMEOUT = "2 hours";

// Plain semver, which the upgrade's commands and commit message take as is.
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * Whether `version` comes before `than` by semver precedence: by major, minor and patch, then a
 * pre-release before its release (`0.45.0-beta.1` < `0.45.0`), and pre-releases by their
 * identifiers, numeric ones by value and before alphanumeric ones. Build metadata is ignored.
 */
function isOlder(version: string, than: string) {
  const parse = (v: string) => {
    const [core = "", pre] = v.split("+", 1)[0]!.split(/-(.*)/s, 2);
    return { core: core.split(".").map(Number), pre: pre === undefined ? [] : pre.split(".") };
  };
  const [a, b] = [parse(version), parse(than)];
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return (a.core[i] ?? 0) < (b.core[i] ?? 0);
  }
  // A release outranks its pre-releases.
  if (a.pre.length === 0 || b.pre.length === 0) return a.pre.length > b.pre.length;
  const numeric = /^\d+$/;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const [x, y] = [a.pre[i], b.pre[i]];
    // A shorter run of identifiers comes first when the longer one starts with it.
    if (x === undefined || y === undefined) return x === undefined;
    if (x === y) continue;
    const [xNumeric, yNumeric] = [numeric.test(x), numeric.test(y)];
    if (xNumeric && yNumeric) return Number(x) < Number(y);
    if (xNumeric !== yNumeric) return xNumeric;
    return x < y;
  }
  return false;
}

type ProjectToUpgrade = { projectId: string; name: string };
type StartedUpgrade = { status: "started"; project: ProjectToUpgrade; instanceId: string };
type ProjectUpgradeStart =
  | StartedUpgrade
  /** Its `main` already installs the version, or a newer one. */
  | { status: "current" }
  | { status: "unreadable"; project: ProjectToUpgrade };

/**
 * Moves every project to a newly published SDK (ADR 0019). `.github/workflows/deploy.yml` starts
 * it once the Template is refreshed. For each project whose `main` installs an older `camox`, it
 * starts a project upgrade (`project-workflow.ts`), which pushes to `main` only if the project
 * builds, and so releases it. Projects upgrade in batches, to throttle their deploys. Once every
 * project is done, one alert lists the projects that didn't build. Nothing else changes a
 * project's code: Rémi fixes those by hand.
 */
export class UpgradeWorkflow extends WorkflowEntrypoint<Bindings, UpgradeParams> {
  async run(event: WorkflowEvent<UpgradeParams>, step: WorkflowStep) {
    const { camoxVersion } = event.payload;
    if (!VERSION.test(camoxVersion)) {
      throw new Error(`Not a published SDK version: ${JSON.stringify(camoxVersion)}`);
    }

    // Only live projects. One still setting up gets the new SDK from the Template, or from a
    // later upgrade. One whose setup failed already alerted Rémi, who sets it up again.
    const all = await step.do("list the projects", async () => {
      return createDb(this.env.DB)
        .select({ projectId: projects.uuid, name: projects.name })
        .from(projects)
        .where(eq(projects.status, "live"))
        .orderBy(asc(projects.id));
    });

    const failed: FailedUpgrade[] = [];
    for (let start = 0; start < all.length; start += PROJECTS_PER_BATCH) {
      const batch = all.slice(start, start + PROJECTS_PER_BATCH);
      const batchNumber = start / PROJECTS_PER_BATCH + 1;
      const { startedAt, upgrades } = await step.do(`start batch ${batchNumber}`, async () => ({
        startedAt: Date.now(),
        upgrades: await Promise.all(
          batch.map((project) => this.startProjectUpgrade(event.instanceId, camoxVersion, project)),
        ),
      }));
      for (const upgrade of upgrades) {
        if (upgrade.status === "current") continue;
        if (upgrade.status === "unreadable") {
          failed.push({ project: upgrade.project, instanceId: null, failure: "unreadable" });
          continue;
        }
        const outcome = await this.outcome(step, upgrade);
        if (!outcome.upgraded) {
          failed.push({
            project: upgrade.project,
            instanceId: upgrade.instanceId,
            failure: outcome.failedStep ?? "unfinished",
          });
        }
      }
      if (start + PROJECTS_PER_BATCH < all.length) {
        await step.sleepUntil(
          `wait out batch ${batchNumber}'s window`,
          startedAt + BATCH_WINDOW_MS,
        );
      }
    }

    if (failed.length > 0) {
      await step.do("alert the projects that didn't build", () =>
        sendUpgradeFailureAlert(this.env, {
          camoxVersion,
          failed,
          workflowInstanceId: event.instanceId,
        }),
      );
    }
    return { failed: failed.map(({ project }) => project.projectId) };
  }

  /**
   * Starts a project's upgrade on the commit its `main` points to, unless that commit already
   * installs this version or a newer one. A repo that can't be read, or has no `main`, can't be
   * upgraded.
   */
  private async startProjectUpgrade(
    upgradeInstanceId: string,
    camoxVersion: string,
    project: ProjectToUpgrade,
  ): Promise<ProjectUpgradeStart> {
    const head = await this.mainHead(project.projectId).catch((error: unknown) => {
      console.error("Repo not read", project.projectId, error);
      return null;
    });
    if (!head) return { status: "unreadable", project };
    if (head.camoxVersion && !isOlder(head.camoxVersion, camoxVersion))
      return { status: "current" };

    const instanceId = `${upgradeInstanceId}-${project.projectId}`;
    const params: ProjectUpgradeParams = {
      provider: "cloudflare-artifacts",
      providerData: { namespace: "projects" } satisfies CloudflareArtifacts["providerData"],
      event: { type: "push" },
      owner: "projects",
      repo: project.projectId,
      sha: head.sha,
      remote: "cloudflare",
      trigger: "push",
      ref: "refs/heads/main",
      branch: "main",
      camoxVersion,
      upgradeInstanceId,
    };
    try {
      await this.env.PROJECT_UPGRADE_WORKFLOW.create({ id: instanceId, params });
    } catch (error) {
      // A retried step: the upgrade started the first time.
      await this.env.PROJECT_UPGRADE_WORKFLOW.get(instanceId).catch(() => {
        throw error;
      });
    }
    return { status: "started", project, instanceId };
  }

  /** The commit `main` points to and the `camox` version it installs, or null without a `main`. */
  private async mainHead(repoName: string) {
    using repo = await this.env.ARTIFACTS.get(repoName);
    const [head] = await repo.log({ ref: "main", limit: 1 });
    if (!head) return null;
    const lockfile = await repo.readFile({ ref: head.hash, path: "pnpm-lock.yaml" });
    return {
      sha: head.hash,
      camoxVersion: lockfile ? camoxVersionInLockfile(await lockfile.text()) : null,
    };
  }

  /** Waits for a project's upgrade to say how it ended, or reads its status after a while. */
  private async outcome(
    step: WorkflowStep,
    upgrade: StartedUpgrade,
  ): Promise<ProjectUpgradeOutcome> {
    try {
      // Waited for one at a time, but none is lost: an instance buffers the events sent before it
      // waits for them (https://developers.cloudflare.com/workflows/build/events-and-parameters/).
      const ended = await step.waitForEvent<ProjectUpgradeOutcome>(
        `wait for ${upgrade.project.projectId}`,
        { type: upgradeEndedEvent(upgrade.project.projectId), timeout: PROJECT_UPGRADE_TIMEOUT },
      );
      return ended.payload;
    } catch {
      return step.do(`read ${upgrade.project.projectId}'s status`, async () => {
        const instance = await this.env.PROJECT_UPGRADE_WORKFLOW.get(upgrade.instanceId);
        const { status } = await instance.status();
        return status === "complete"
          ? { upgraded: true as const }
          : { upgraded: false as const, failedStep: null };
      });
    }
  }
}
