import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { introspectWorkflowInstance, type WorkflowInstanceIntrospector } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";
import { projects, releases } from "../../schema";
import type { Bindings } from "../../types";

// A push to a project's repo releases it: the release Workflow installs, runs `camox release`
// and deploys the project's Worker, each in a sandbox, and records the release as a row.
// Cloudflare Artifacts, the sandbox and email are faked at their bindings (test/release-fakes.js).

const fakes = (env as unknown as { RELEASE_FAKES: ReleaseFakes }).RELEASE_FAKES;

type ReleaseFakes = {
  /** Pushes `files` as `commit` to the repo's `main`, and returns the commit's tree. */
  push(repo: string, commit: string, files: Record<string, string>): Promise<string>;
  failCommand(repo: string, pattern: string, times: number): Promise<void>;
  hold(repo: string, pattern: string): Promise<void>;
  letGo(repo: string): Promise<void>;
  commandsRun(repo: string): Promise<{ command: string; env: Record<string, string> }[]>;
  failEmailsAbout(pattern: string): Promise<void>;
  emailsSent(): Promise<Email[]>;
};

type Email = {
  from: { name: string; email: string };
  to: string;
  subject: string;
  text: string;
  html: string;
};

/** The emails about a project: every alert names its Project ID. */
async function emailsAbout(projectId: string) {
  return (await fakes.emailsSent()).filter(({ text }) => text.includes(projectId));
}

// The account and Workflow the alert links to, as the test bindings set the account
// (vite.config.ts) and wrangler.jsonc names the Workflow.
const WORKFLOW_INSTANCES =
  "https://dash.cloudflare.com/0123456789abcdef0123456789abcdef/workers/workflows/camox-release/instance";

// The variable that turns on the build checks only hosted projects have (`HOSTED_BUILD_ENV` in
// packages/sdk/src/features/vite/hostedChecks.ts).
const HOSTED_BUILD_ENV = "CAMOX_INTERNAL_HOSTED";

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
        { id: commit, message: "Change the hero", author: { name: "Rémi", email: "r@camox.ai" } },
      ],
    },
  };
}

type Fixture = Awaited<ReturnType<typeof createProjectFixture>>;

type Modifier = Parameters<Parameters<WorkflowInstanceIntrospector["modify"]>[0]>[0];

/**
 * Starts the release Workflow the way the push event does, waits for it to end, and returns its
 * instance ID and the error it ended with, if any.
 */
async function receivePush(
  event: ReturnType<typeof pushEvent>,
  end: "complete" | "errored" = "complete",
  modify?: (m: Modifier) => Promise<void>,
) {
  const id = crypto.randomUUID();
  await using instance = await introspectWorkflowInstance(env.RELEASE_WORKFLOW, id);
  await instance.modify(async (m) => {
    await m.disableRetryDelays();
    await modify?.(m);
  });
  await env.RELEASE_WORKFLOW.create({ id, params: event });
  await instance.waitForStatus(end);
  const { error } = await (await env.RELEASE_WORKFLOW.get(id)).status();
  return { instanceId: id, error };
}

describe("a push to a project's main branch", () => {
  it("releases the project and records the release as succeeded", async () => {
    const { db, project: released } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    const commit = commitSha();
    const tree = await fakes.push(released.uuid, commit, { "pnpm-lock.yaml": lockfile("0.9.1") });

    const before = Date.now();
    const { instanceId } = await receivePush(pushEvent(released.uuid, "refs/heads/main", commit));

    const rows = await db.select().from(releases).where(eq(releases.projectId, released.id));
    expect(rows).toEqual([
      expect.objectContaining({
        commit,
        tree,
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
    expect(await emailsAbout(released.uuid)).toEqual([]);
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

  it("builds as a hosted project, so code breaking a hosted check fails the release before it deploys", async () => {
    const { db, project: failing } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    const commit = commitSha();
    await fakes.push(failing.uuid, commit, { "pnpm-lock.yaml": lockfile("0.9.2") });
    // The hosted checks fail the build, as `camox release` does when they fail (the SDK's
    // features/vite/hostedChecks.ts).
    await fakes.failCommand(failing.uuid, "camox release", Infinity);

    await receivePush(pushEvent(failing.uuid, "refs/heads/main", commit), "errored");

    const runs = await fakes.commandsRun(failing.uuid);
    expect(runs.map(({ command }) => command)).toContain("pnpm exec camox release");
    // Only the build has the flag: the install and the deploy run no project code through Vite.
    for (const { command, env } of runs) {
      expect(env[HOSTED_BUILD_ENV] === "1").toBe(command === "pnpm exec camox release");
    }
    // Nothing deployed: Live keeps serving its previous release.
    expect(runs.some(({ command }) => command.includes("wrangler deploy"))).toBe(false);
    const rows = await db.select().from(releases).where(eq(releases.projectId, failing.id));
    expect(rows).toEqual([expect.objectContaining({ status: "failed", failedStep: "release" })]);
  });

  it("records the release as failed at the step that gave up", async () => {
    const { db, project: failing } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    const commit = commitSha();
    await fakes.push(failing.uuid, commit, { "pnpm-lock.yaml": lockfile("0.9.2") });
    await fakes.failCommand(failing.uuid, "wrangler deploy", Infinity);

    const { instanceId } = await receivePush(
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

  it("emails an alert once when a release fails for good, naming its project, commit and failed step", async () => {
    const { db, project: failing } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    await db.update(projects).set({ name: "Acme & Co" }).where(eq(projects.id, failing.id));
    const commit = commitSha();
    await fakes.push(failing.uuid, commit, { "pnpm-lock.yaml": lockfile("0.9.2") });
    await fakes.failCommand(failing.uuid, "camox release", Infinity);

    const { instanceId } = await receivePush(
      pushEvent(failing.uuid, "refs/heads/main", commit),
      "errored",
    );

    const emails = await emailsAbout(failing.uuid);
    expect(emails).toEqual([
      expect.objectContaining({
        from: { name: "Camox", email: "alerts@camox.ai" },
        to: "alerts@camox.ai",
        subject: expect.stringContaining("Acme & Co"),
      }),
    ]);
    const [email] = emails;
    const instance = `${WORKFLOW_INSTANCES}/${instanceId}`;
    for (const named of [failing.uuid, commit, "Failed step: release\n", instance]) {
      expect(email!.text).toContain(named);
    }
    expect(email!.html).toContain("Acme &amp; Co");
    expect(email!.html).toContain(`href="${instance}"`);
  });

  it("still fails with the step's error and records it when the alert can't be sent", async () => {
    const { db, project: failing } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    const commit = commitSha();
    await fakes.push(failing.uuid, commit, { "pnpm-lock.yaml": lockfile("0.9.2") });
    await fakes.failCommand(failing.uuid, "wrangler deploy", Infinity);
    await fakes.failEmailsAbout(failing.uuid);

    const { error } = await receivePush(
      pushEvent(failing.uuid, "refs/heads/main", commit),
      "errored",
    );

    expect(error?.message).toMatch(/^CiRunnerFailure: deploy failed/);
    const rows = await db.select().from(releases).where(eq(releases.projectId, failing.id));
    expect(rows).toEqual([expect.objectContaining({ status: "failed", failedStep: "deploy" })]);
  });

  it("still alerts, and fails with the step's error, when the failed release can't be recorded", async () => {
    const { project: failing } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    const commit = commitSha();
    await fakes.push(failing.uuid, commit, { "pnpm-lock.yaml": lockfile("0.9.2") });
    await fakes.failCommand(failing.uuid, "wrangler deploy", Infinity);

    const { error } = await receivePush(
      pushEvent(failing.uuid, "refs/heads/main", commit),
      "errored",
      (m) => m.mockStepError({ name: "record the failed release" }, new Error("D1 is down")),
    );

    expect(await emailsAbout(failing.uuid)).toEqual([
      expect.objectContaining({ text: expect.stringContaining("Failed step: deploy\n") }),
    ]);
    expect(error?.message).toMatch(/^CiRunnerFailure: deploy failed/);
  });

  it("names the project by its Project ID in an alert from an instance that recorded no name", async () => {
    // Instances started before the release step recorded the project's name replay its old
    // output, which has only the project's row id.
    const { project: failing } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    const commit = commitSha();
    await fakes.push(failing.uuid, commit, { "pnpm-lock.yaml": lockfile("0.9.2") });
    await fakes.failCommand(failing.uuid, "pnpm install", Infinity);

    await receivePush(pushEvent(failing.uuid, "refs/heads/main", commit), "errored", (m) =>
      m.mockStepResult({ name: "record the release" }, { projectId: failing.id }),
    );

    const [email] = await emailsAbout(failing.uuid);
    expect(email?.subject).toContain(failing.uuid);
    expect(email?.text).not.toContain("undefined");
  });

  it("sends no alert when a step fails and its retry passes", async () => {
    const { project: flaky } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    const commit = commitSha();
    await fakes.push(flaky.uuid, commit, { "pnpm-lock.yaml": lockfile("0.9.1") });
    await fakes.failCommand(flaky.uuid, "wrangler deploy", 1);

    await receivePush(pushEvent(flaky.uuid, "refs/heads/main", commit));

    expect(await emailsAbout(flaky.uuid)).toEqual([]);
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

describe("a push of the tree Live serves", () => {
  // A publish with code puts its tree on Live itself, then pushes that tree to `main`. The push
  // mustn't release the same code again.
  const files = { "pnpm-lock.yaml": lockfile("0.9.1"), "src/blocks/hero.tsx": "export {}" };

  /** Pushes `files` as a new commit to the project's `main` and runs its release Workflow. */
  async function pushAndRelease(repo: string, pushed: Record<string, string>) {
    const commit = commitSha();
    await fakes.push(repo, commit, pushed);
    await receivePush(pushEvent(repo, "refs/heads/main", commit));
    return commit;
  }

  it("completes without installing, building or deploying, and records no release", async () => {
    const { db, project } = await createProjectFixture(`release-workflow-${crypto.randomUUID()}`);
    const served = await pushAndRelease(project.uuid, files);
    const ranBefore = (await fakes.commandsRun(project.uuid)).length;

    // A new commit with the same tree, as a publish's squashed commit has.
    await pushAndRelease(project.uuid, files);

    expect(await fakes.commandsRun(project.uuid)).toHaveLength(ranBefore);
    const rows = await db.select().from(releases).where(eq(releases.projectId, project.id));
    expect(rows).toEqual([expect.objectContaining({ commit: served, status: "succeeded" })]);
    expect(await emailsAbout(project.uuid)).toEqual([]);
  });

  /** The commits the project's succeeded releases served, oldest first. */
  async function succeeded(db: Fixture["db"], projectId: number) {
    const rows = await db.select().from(releases).where(eq(releases.projectId, projectId));
    return rows.filter(({ status }) => status === "succeeded").map(({ commit }) => commit);
  }

  it("releases a push whose tree differs", async () => {
    const { db, project } = await createProjectFixture(`release-workflow-${crypto.randomUUID()}`);
    const served = await pushAndRelease(project.uuid, files);

    const changed = await pushAndRelease(project.uuid, { ...files, "src/blocks/cta.tsx": "" });

    expect(await succeeded(db, project.id)).toEqual([served, changed]);
  });

  it("releases a push of a tree Live served before, but no longer does", async () => {
    const { db, project } = await createProjectFixture(`release-workflow-${crypto.randomUUID()}`);
    const first = await pushAndRelease(project.uuid, files);
    const second = await pushAndRelease(project.uuid, { ...files, "src/blocks/cta.tsx": "" });

    const reverted = await pushAndRelease(project.uuid, files);

    expect(await succeeded(db, project.id)).toEqual([first, second, reverted]);
  });

  it("releases a push of a tree whose release failed", async () => {
    const { db, project } = await createProjectFixture(`release-workflow-${crypto.randomUUID()}`);
    const commit = commitSha();
    await fakes.push(project.uuid, commit, files);
    // Fails every attempt of that release, then passes.
    await fakes.failCommand(project.uuid, "wrangler deploy", 3);
    await receivePush(pushEvent(project.uuid, "refs/heads/main", commit), "errored");

    const again = await pushAndRelease(project.uuid, files);

    expect(await succeeded(db, project.id)).toEqual([again]);
  });

  it("still re-runs a restarted release of the tree Live serves", async () => {
    const { project } = await createProjectFixture(`release-workflow-${crypto.randomUUID()}`);
    const commit = commitSha();
    await fakes.push(project.uuid, commit, files);
    const instanceId = crypto.randomUUID();
    await using instance = await introspectWorkflowInstance(env.RELEASE_WORKFLOW, instanceId);
    const run = await env.RELEASE_WORKFLOW.create({
      id: instanceId,
      params: pushEvent(project.uuid, "refs/heads/main", commit),
    });
    await instance.waitForStatus("complete");
    const ranBefore = (await fakes.commandsRun(project.uuid)).length;

    await run.restart();
    await instance.waitForStatus("complete");

    expect(await fakes.commandsRun(project.uuid)).toHaveLength(ranBefore * 2);
  });
});

describe("a release that a project's deletion overtakes", () => {
  /**
   * Starts a release, then deletes its project while `camox release` runs, as deleting it from
   * the dashboard removes its rows, and waits for the release to end.
   */
  async function releaseWhileDeleting(end: "complete" | "errored", { failRelease = false } = {}) {
    const { db, project, memberUser } = await createProjectFixture(
      `release-workflow-${crypto.randomUUID()}`,
    );
    const member = createRpcContext(db, memberUser);
    // Its cleanup is the deletion Workflow's tests' concern.
    const cleanUp = {
      create: async () => undefined,
    } as unknown as Bindings["PROJECT_DELETION_WORKFLOW"];
    const context = { ...member, env: { ...member.env, PROJECT_DELETION_WORKFLOW: cleanUp } };
    const commit = commitSha();
    await fakes.push(project.uuid, commit, { "pnpm-lock.yaml": lockfile("0.9.1") });
    if (failRelease) await fakes.failCommand(project.uuid, "camox release", Infinity);
    await fakes.hold(project.uuid, "camox release");
    const released = receivePush(pushEvent(project.uuid, "refs/heads/main", commit), end);
    while (!(await fakes.commandsRun(project.uuid)).some((run) => run.command.includes("camox"))) {
      await scheduler.wait(20);
    }
    await call(router.projects.delete, { id: project.id }, { context });
    await fakes.letGo(project.uuid);
    await released;
    return project;
  }

  it("doesn't deploy the deleted project's Worker, nor alert", async () => {
    const project = await releaseWhileDeleting("complete");

    const commands = (await fakes.commandsRun(project.uuid)).map(({ command }) => command);
    expect(commands).toEqual(["pnpm install --frozen-lockfile", "pnpm exec camox release"]);
    expect(await emailsAbout(project.uuid)).toEqual([]);
  });

  it("doesn't alert when it then fails", async () => {
    const project = await releaseWhileDeleting("errored", { failRelease: true });

    expect(await emailsAbout(project.uuid)).toEqual([]);
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
