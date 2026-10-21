import { generateUuidv7 } from "@camox/api-contract/ids";
import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture } from "../../../test/fixtures";
import { projects, releases } from "../../schema";

// A push to a project's repo releases it: the release Workflow installs, runs `camox release`
// and deploys the project's Worker, each in a sandbox, and records the release as a row.
// Cloudflare Artifacts and the sandbox are faked at their bindings (test/release-fakes.js).

const fakes = (env as unknown as { RELEASE_FAKES: ReleaseFakes }).RELEASE_FAKES;

type ReleaseFakes = {
  push(repo: string, commit: string, files: Record<string, string>): Promise<void>;
  failCommand(repo: string, pattern: string, times: number): Promise<void>;
  commandsRun(repo: string): Promise<{ command: string; env: Record<string, string> }[]>;
};

// The Cloudflare token `wrangler deploy` gets, as the test bindings set it (vite.config.ts).
const CLOUDFLARE_TOKEN = "test-cloudflare-token";

function lockfile(camoxVersion: string) {
  return [
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  .:",
    "    dependencies:",
    "      '@tanstack/react-query':",
    "        specifier: ^5.104.3",
    "        version: 5.104.3(react@19.3.1)",
    "      camox:",
    `        specifier: ${camoxVersion}`,
    `        version: ${camoxVersion}(@tanstack/react-query@5.104.3(react@19.3.1))(react@19.3.1)`,
    "      react:",
    "        specifier: ^19.3.1",
    "        version: 19.3.1",
    "",
  ].join("\n");
}

function commitSha() {
  return crypto.randomUUID().replaceAll("-", "").padEnd(40, "0");
}

/** The `cf.artifacts.repo.pushed` event Cloudflare Artifacts sends for a push. */
function pushEvent(repo: string, ref: string, commit: string) {
  return {
    type: "cf.artifacts.repo.pushed",
    source: { type: "artifacts.repo", namespace: "projects", repoName: repo },
    payload: {
      ref,
      before: "0".repeat(39) + "1",
      after: commit,
      commits: [
        { id: commit, message: "Change the hero", author: { name: "Rémi", email: "r@camox.dev" } },
      ],
    },
  };
}

/** Starts the release Workflow the way the push event does, and waits for it to end. */
async function receivePush(
  event: ReturnType<typeof pushEvent>,
  end: "complete" | "errored" = "complete",
) {
  const id = crypto.randomUUID();
  await using instance = await introspectWorkflowInstance(env.RELEASE_WORKFLOW, id);
  await instance.modify(async (m) => {
    await m.disableRetryDelays();
  });
  await env.RELEASE_WORKFLOW.create({ id, params: event });
  await instance.waitForStatus(end);
  return id;
}

describe("a push to a project's main branch", () => {
  it("releases the project and records the release as succeeded", async () => {
    const { db, project: released } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    const commit = commitSha();
    await fakes.push(released.uuid, commit, { "pnpm-lock.yaml": lockfile("0.9.1") });

    const before = Date.now();
    const instanceId = await receivePush(pushEvent(released.uuid, "refs/heads/main", commit));

    const rows = await db.select().from(releases).where(eq(releases.projectId, released.id));
    expect(rows).toEqual([
      expect.objectContaining({
        commit,
        camoxVersion: "0.9.1",
        status: "succeeded",
        failedStep: null,
        workflowInstanceId: instanceId,
      }),
    ]);
    const [row] = rows;
    expect(row!.startedAt).toBeGreaterThanOrEqual(before);
    expect(row!.endedAt).toBeGreaterThanOrEqual(row!.startedAt);

    const commands = (await fakes.commandsRun(released.uuid)).map(({ command }) => command);
    expect(commands).toEqual([
      "pnpm install --frozen-lockfile",
      "pnpm exec camox release",
      `pnpm exec wrangler deploy --dispatch-namespace production --name ${released.uuid}`,
    ]);
  });

  it("gives the Deploy Token only to `camox release`, and Camox's Cloudflare token only to the deploy", async () => {
    const { project: released } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    const commit = commitSha();
    await fakes.push(released.uuid, commit, { "pnpm-lock.yaml": lockfile("0.9.1") });

    await receivePush(pushEvent(released.uuid, "refs/heads/main", commit));

    const runs = await fakes.commandsRun(released.uuid);
    const holding = (secret: string) =>
      runs
        .filter(({ env }) => Object.values(env).includes(secret))
        .map(({ command }) => command.split(" ").slice(0, 3).join(" "));
    expect(holding(released.deployToken)).toEqual(["pnpm exec camox"]);
    expect(holding(CLOUDFLARE_TOKEN)).toEqual(["pnpm exec wrangler"]);
    const release = runs.find(({ command }) => command.includes("camox release"));
    expect(release?.env.CAMOX_DEPLOY_TOKEN).toBe(released.deployToken);
  });

  it("records the release as failed at the step that gave up", async () => {
    const { db, project: failing } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    const commit = commitSha();
    await fakes.push(failing.uuid, commit, { "pnpm-lock.yaml": lockfile("0.9.2") });
    await fakes.failCommand(failing.uuid, "wrangler deploy", Infinity);

    const instanceId = await receivePush(
      pushEvent(failing.uuid, "refs/heads/main", commit),
      "errored",
    );

    const rows = await db.select().from(releases).where(eq(releases.projectId, failing.id));
    expect(rows).toEqual([
      expect.objectContaining({
        commit,
        camoxVersion: "0.9.2",
        status: "failed",
        failedStep: "deploy",
        workflowInstanceId: instanceId,
      }),
    ]);
    expect(rows[0]!.endedAt).toBeGreaterThanOrEqual(rows[0]!.startedAt);
  });

  it("succeeds once when a step fails and its retry passes", async () => {
    const { db, project: flaky } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    const commit = commitSha();
    await fakes.push(flaky.uuid, commit, { "pnpm-lock.yaml": lockfile("0.9.1") });
    await fakes.failCommand(flaky.uuid, "camox release", 1);

    await receivePush(pushEvent(flaky.uuid, "refs/heads/main", commit));

    const rows = await db.select().from(releases).where(eq(releases.projectId, flaky.id));
    expect(rows).toEqual([expect.objectContaining({ status: "succeeded", failedStep: null })]);
    const commands = (await fakes.commandsRun(flaky.uuid)).map(({ command }) => command);
    expect(commands.filter((command) => command === "pnpm exec camox release")).toHaveLength(2);
  });

  it("records a failed release that is re-run and passes as succeeded", async () => {
    const { db, project: rerun } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    const commit = commitSha();
    await fakes.push(rerun.uuid, commit, { "pnpm-lock.yaml": lockfile("0.9.1") });
    // Fails every attempt of the first run, so that it gives up, then passes on the re-run.
    await fakes.failCommand(rerun.uuid, "wrangler deploy", 3);
    const instanceId = crypto.randomUUID();
    await using instance = await introspectWorkflowInstance(env.RELEASE_WORKFLOW, instanceId);
    await instance.modify(async (m) => {
      await m.disableRetryDelays();
    });
    const run = await env.RELEASE_WORKFLOW.create({
      id: instanceId,
      params: pushEvent(rerun.uuid, "refs/heads/main", commit),
    });
    await instance.waitForStatus("errored");

    const before = Date.now();
    await run.restart();
    await instance.waitForStatus("complete");

    const rows = await db.select().from(releases).where(eq(releases.projectId, rerun.id));
    expect(rows).toEqual([
      expect.objectContaining({
        status: "succeeded",
        failedStep: null,
        workflowInstanceId: instanceId,
      }),
    ]);
    expect(rows[0]!.startedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("a push that isn't a release", () => {
  it("starts nothing for a branch other than main", async () => {
    const { db, project: wip } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    const commit = commitSha();
    await fakes.push(wip.uuid, commit, { "pnpm-lock.yaml": lockfile("0.9.1") });

    await receivePush(pushEvent(wip.uuid, "refs/heads/main-wip", commit));

    expect(await db.select().from(releases).where(eq(releases.projectId, wip.id))).toEqual([]);
    expect(await fakes.commandsRun(wip.uuid)).toEqual([]);
  });

  it("starts nothing for a repo that isn't a project's, such as the Template's", async () => {
    // Even a project row with that name doesn't release it: only a Project ID names a project's
    // repo and Worker, and the deploy's `--name` comes from it.
    const { db, project: misnamed } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    await db.update(projects).set({ uuid: "template-default" }).where(eq(projects.id, misnamed.id));
    const commit = commitSha();
    await fakes.push("template-default", commit, { "pnpm-lock.yaml": lockfile("0.9.1") });

    await receivePush(pushEvent("template-default", "refs/heads/main", commit));

    expect(await fakes.commandsRun("template-default")).toEqual([]);
  });

  it("starts nothing for a Project ID no project has", async () => {
    const repo = generateUuidv7();
    const commit = commitSha();
    await fakes.push(repo, commit, { "pnpm-lock.yaml": lockfile("0.9.1") });

    await receivePush(pushEvent(repo, "refs/heads/main", commit));

    expect(await fakes.commandsRun(repo)).toEqual([]);
  });
});
