import { sdkBundleName } from "camox/_internal/sdkBundleName";
import {
  introspectWorkflow,
  introspectWorkflowInstance,
  type WorkflowIntrospector,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createProjectFixture } from "../../../test/fixtures";
import { websiteLockfile } from "../../../test/website-lockfile";
import { projects } from "../../schema";
import { HOSTED_SDK_BUNDLE_SETTINGS, sdkBundleArchiveKey } from "../sdk-bundles/ensure";
import { buildCommand, updateCommand } from "./commands";
import { PROJECTS_PER_BATCH } from "./workflow";

// After each SDK publish, the upgrade Workflow moves every project to the new SDK: in a sandbox,
// it moves the Camox packages to the new version, builds without releasing, and pushes only what builds to `main`,
// which releases it. Cloudflare Artifacts, the sandbox and email are faked at their bindings
// (test/release-fakes.js).

const fakes = (env as unknown as { RELEASE_FAKES: ReleaseFakes }).RELEASE_FAKES;

type ReleaseFakes = {
  push(repo: string, commit: string, files: Record<string, string>): Promise<void>;
  failCommand(repo: string, pattern: string, times: number): Promise<void>;
  hold(repo: string, pattern: string): Promise<void>;
  letGo(repo: string): Promise<void>;
  commandsRun(repo: string): Promise<CommandRun[]>;
  /** Makes `pnpm install` in the repo's upgrade write `lockfile`, as resolving the new SDK would. */
  installResolves(repo: string, lockfile: string): Promise<void>;
  sdkBundleBuilds(): Promise<{ written: Record<string, string>; order: number }[]>;
  buildAgainstSdkBundlesOf(marker: string): Promise<void>;
  emailsSent(): Promise<Email[]>;
};

type CommandRun = {
  command: string;
  env: Record<string, string>;
  order: number;
  /** For `camox release`: what its SDK Bundle cache held, by folder name. */
  sdkBundleCache?: Record<string, string>;
};

type Email = {
  from: { name: string; email: string };
  to: string;
  subject: string;
  text: string;
  html: string;
};

// The variable that turns on the build checks only hosted projects have (`HOSTED_BUILD_ENV` in
// packages/sdk/src/features/vite/hostedChecks.ts).
const HOSTED_BUILD_ENV = "CAMOX_INTERNAL_HOSTED";

// The account the alert links to, as the test bindings set it (vite.config.ts).
const WORKFLOWS = "https://dash.cloudflare.com/0123456789abcdef0123456789abcdef/workers/workflows";

const NEW_VERSION = "0.10.0";

const TEMPLATE_REPO = "template-default";

const lockfile = (camoxVersion: string) => websiteLockfile(camoxVersion);

function packageJson(dependencies: Record<string, string>, devDependencies = {}) {
  return JSON.stringify({ name: "site", private: true, dependencies, devDependencies }, null, 2);
}

function commitSha() {
  return crypto.randomUUID().replaceAll("-", "").padEnd(40, "0");
}

const projectsWithRepos: string[] = [];

/** A project whose `main` is a commit of the Template on `camoxVersion`. */
async function projectOn(camoxVersion: string, files: Record<string, string> = {}) {
  const fixture = await createProjectFixture(`upgrade-workflow-${crypto.randomUUID()}`);
  const head = commitSha();
  projectsWithRepos.push(fixture.project.uuid);
  await fakes.push(fixture.project.uuid, head, {
    "package.json": packageJson({ camox: `^${camoxVersion}`, react: "^19.3.1" }),
    "pnpm-lock.yaml": lockfile(camoxVersion),
    ...files,
  });
  return { ...fixture, head };
}

/** Upgrades every project to `camoxVersion` the way the SDK publish starts it, and waits for it. */
async function upgradeTo(camoxVersion: string) {
  await using upgrades: WorkflowIntrospector = await introspectWorkflow(
    env.PROJECT_UPGRADE_WORKFLOW,
  );
  await upgrades.modifyAll(async (m) => {
    await m.disableRetryDelays();
  });
  const id = crypto.randomUUID();
  await using instance = await introspectWorkflowInstance(env.UPGRADE_WORKFLOW, id);
  await instance.modify(async (m) => {
    await m.disableSleeps();
    await m.disableRetryDelays();
  });
  await env.UPGRADE_WORKFLOW.create({ id, params: { camoxVersion } });
  await instance.waitForStatus("complete").catch(async (cause: unknown) => {
    const { error } = await (await env.UPGRADE_WORKFLOW.get(id)).status();
    throw new Error(`The upgrade failed: ${error?.message}`, { cause });
  });
  return id;
}

async function commands(repo: string) {
  return (await fakes.commandsRun(repo)).map(({ command }) => command);
}

/** The commands that pushed to the repo's `main`. */
async function pushesToMain(repo: string) {
  return (await fakes.commandsRun(repo)).filter(({ command }) =>
    command.includes("git push -q origin HEAD:refs/heads/main"),
  );
}

/** Whether the SDK Bundle of `lockfile` is stored, with both its targets. */
async function sdkBundleStored(lockfile: string) {
  const stored = await Promise.all(
    (["browser", "workerd"] as const).map(async (target) => {
      const name = await sdkBundleName({ lockfile, target, settings: HOSTED_SDK_BUNDLE_SETTINGS });
      return env.REVISION_BUILDS.head(sdkBundleArchiveKey(name));
    }),
  );
  return stored.every(Boolean);
}

/** When the SDK Bundle of `lockfile` started building, by the fakes' clock. */
async function sdkBundleBuiltAt(lockfile: string) {
  const builds = await fakes.sdkBundleBuilds();
  return builds.find(({ written }) => written["pnpm-lock.yaml"] === lockfile)?.order;
}

/** The Template, as the SDK publish refreshes it before the upgrade starts. */
async function refreshTemplate(templateLockfile: string) {
  await fakes.push(TEMPLATE_REPO, commitSha(), {
    "package.json": packageJson({ camox: `^${NEW_VERSION}`, react: "^19.3.1" }),
    "pnpm-lock.yaml": templateLockfile,
  });
}

async function emailsAbout(projectId: string) {
  return (await fakes.emailsSent()).filter(({ text }) => text.includes(projectId));
}

describe("upgrading every project to a new SDK", () => {
  beforeEach(() => refreshTemplate(lockfile(NEW_VERSION)));

  // Every upgrade covers every project, and this file's tests share one database: once a test is
  // done, its projects are on the new SDK, so later upgrades leave them alone.
  afterEach(async () => {
    for (const repo of projectsWithRepos.splice(0)) {
      await fakes.push(repo, commitSha(), { "pnpm-lock.yaml": lockfile(NEW_VERSION) });
    }
  });

  it("updates the Camox packages, builds without releasing, then pushes each project that builds to main", async () => {
    const first = await projectOn("0.9.1");
    const second = await projectOn("0.9.2");

    await upgradeTo(NEW_VERSION);

    for (const { project } of [first, second]) {
      expect(await commands(project.uuid)).toEqual([
        updateCommand(`npm pkg set dependencies.camox=^${NEW_VERSION}`),
        buildCommand(),
        expect.stringContaining(`git commit -q -m "Upgrade Camox to ${NEW_VERSION}"`),
      ]);
      expect(await pushesToMain(project.uuid)).toHaveLength(1);
      expect(await emailsAbout(project.uuid)).toEqual([]);
    }
  });

  it("ensures the Template's SDK Bundle before upgrading any project", async () => {
    // Its own resolution, so no other test stored its SDK Bundle.
    const templateLockfile = websiteLockfile(NEW_VERSION, {
      react: `19.3.1-${crypto.randomUUID()}`,
    });
    await refreshTemplate(templateLockfile);
    const { project } = await projectOn("0.9.1");

    await upgradeTo(NEW_VERSION);

    expect(await sdkBundleStored(templateLockfile)).toBe(true);
    const [firstCommand] = await fakes.commandsRun(project.uuid);
    expect(await sdkBundleBuiltAt(templateLockfile)).toBeLessThan(firstCommand!.order);
  });

  it("ensures each project's own SDK Bundle, from its upgraded lockfile, before its dry-run release", async () => {
    const { project } = await projectOn("0.9.1");
    // The project resolves the new SDK's packages unlike the Template.
    const upgradedLockfile = websiteLockfile(NEW_VERSION, {
      react: `19.3.1-${crypto.randomUUID()}`,
    });
    await fakes.installResolves(project.uuid, upgradedLockfile);

    await upgradeTo(NEW_VERSION);

    expect(await sdkBundleStored(upgradedLockfile)).toBe(true);
    const build = (await fakes.commandsRun(project.uuid)).find(
      ({ command }) => command === buildCommand(),
    );
    expect(await sdkBundleBuiltAt(upgradedLockfile)).toBeLessThan(build!.order);
    expect(await pushesToMain(project.uuid)).toHaveLength(1);
  });

  it("builds its dry-run release against the SDK Bundle of its upgraded lockfile", async () => {
    // The new SDK's camox builds against an SDK Bundle.
    const switchedOn = `// built against an SDK Bundle ${crypto.randomUUID()}`;
    await fakes.buildAgainstSdkBundlesOf(switchedOn);
    const { project } = await projectOn("0.9.1", { "src/camox.ts": `${switchedOn}\n` });
    const upgradedLockfile = websiteLockfile(NEW_VERSION, {
      react: `19.3.1-${crypto.randomUUID()}`,
    });
    await fakes.installResolves(project.uuid, upgradedLockfile);

    await upgradeTo(NEW_VERSION);

    const build = (await fakes.commandsRun(project.uuid)).find(
      ({ command }) => command === buildCommand(),
    );
    const names = await Promise.all(
      (["browser", "workerd"] as const).map((target) =>
        sdkBundleName({ lockfile: upgradedLockfile, target, settings: HOSTED_SDK_BUNDLE_SETTINGS }),
      ),
    );
    expect(Object.keys(build!.sdkBundleCache!).sort()).toEqual(names.sort());
    expect(await pushesToMain(project.uuid)).toHaveLength(1);
  });

  it("pushes on top of main unless main changed its package.json or lockfile since, with a write token only that step gets", async () => {
    const { project, head } = await projectOn("0.9.1");

    await upgradeTo(NEW_VERSION);

    const [push] = await pushesToMain(project.uuid);
    expect(push?.command).toContain(`fetch -q --depth=1 origin ${head} refs/heads/main:`);
    expect(push?.command).toContain(
      `git diff --quiet ${head} origin/main -- package.json pnpm-lock.yaml`,
    );
    // Pushed with a write token of the project's own repo, which only this step gets.
    expect(push?.env.UPGRADE_GIT_REMOTE).toMatch(new RegExp(`/projects/${project.uuid}\\.git$`));
    expect(push?.env.GIT_CONFIG_VALUE_0).toMatch(/^Authorization: Bearer artifacts-write-token\b/);
    const others = (await fakes.commandsRun(project.uuid)).filter(
      ({ command }) => command !== push!.command,
    );
    expect(others).toHaveLength(2);
    for (const { env } of others) expect(Object.values(env).join("\n")).not.toContain("write");
  });

  it("builds as a hosted project, so code that breaks a new hosted check isn't pushed", async () => {
    const { project } = await projectOn("0.9.1");
    // The new SDK's hosted checks fail the build, as `camox release --dry-run` does when they
    // fail (the SDK's features/vite/hostedChecks.ts).
    await fakes.failCommand(project.uuid, "camox release --dry-run", Infinity);

    await upgradeTo(NEW_VERSION);

    const runs = await fakes.commandsRun(project.uuid);
    expect(runs.map(({ command }) => command)).toContain(buildCommand());
    // Only the build has the flag: the update and the push run no project code through Vite.
    for (const { command, env } of runs) {
      expect(env[HOSTED_BUILD_ENV] === "1").toBe(command === buildCommand());
    }
    expect(await pushesToMain(project.uuid)).toEqual([]);
  });

  it("updates every Camox package a project depends on, where it depends on it", async () => {
    const { project } = await projectOn("0.9.1", {
      "package.json": packageJson(
        { camox: "^0.9.1", "@camox/ui": "^0.9.1", react: "^19.3.1" },
        { "@camox/cli": "^0.9.1", wrangler: "^4.151.0" },
      ),
    });

    await upgradeTo(NEW_VERSION);

    expect((await commands(project.uuid))[0]).toBe(
      updateCommand(
        `npm pkg set dependencies.camox=^${NEW_VERSION} dependencies.@camox/ui=^${NEW_VERSION} devDependencies.@camox/cli=^${NEW_VERSION}`,
      ),
    );
  });

  it("leaves a project that doesn't build untouched, and emails one alert listing every such project with its logs", async () => {
    const builds = await projectOn("0.9.1");
    const broken = await projectOn("0.9.1");
    const alsoBroken = await projectOn("0.9.1");
    for (const { project } of [broken, alsoBroken]) {
      await fakes.failCommand(project.uuid, "camox release --dry-run", Infinity);
    }

    const instanceId = await upgradeTo(NEW_VERSION);

    expect(await pushesToMain(broken.project.uuid)).toEqual([]);
    expect(await pushesToMain(alsoBroken.project.uuid)).toEqual([]);
    expect(await pushesToMain(builds.project.uuid)).toHaveLength(1);

    const emails = await emailsAbout(broken.project.uuid);
    expect(emails).toEqual([
      expect.objectContaining({
        from: { name: "Camox", email: "alerts@camox.ai" },
        to: "alerts@camox.ai",
        subject: expect.stringContaining(NEW_VERSION),
      }),
    ]);
    const [email] = emails;
    for (const { project } of [broken, alsoBroken]) {
      // Its logs: the project's own upgrade, named after the Project ID.
      const logs = new RegExp(
        `${WORKFLOWS}/camox-project-upgrade/instance/\\S*${project.uuid}\\S*`,
      );
      expect(email!.text).toMatch(logs);
      expect(email!.html).toMatch(new RegExp(`href="${logs.source}"`));
      expect(email!.text).toContain(`${project.uuid}, failed at its build step`);
    }
    expect(email!.text).not.toContain(builds.project.uuid);
    expect(email!.text).toContain(`${WORKFLOWS}/camox-upgrade/instance/${instanceId}`);
  });

  it("doesn't push a project whose update doesn't install", async () => {
    const { project } = await projectOn("0.9.1");
    await fakes.failCommand(project.uuid, "pnpm install", Infinity);

    await upgradeTo(NEW_VERSION);

    expect(await pushesToMain(project.uuid)).toEqual([]);
    const [email] = await emailsAbout(project.uuid);
    expect(email?.text).toContain(`${project.uuid}, failed at its update step`);
  });

  it("still pushes when a step fails and its retry passes, and alerts nobody", async () => {
    const { project } = await projectOn("0.9.1");
    await fakes.failCommand(project.uuid, "git push", 1);

    await upgradeTo(NEW_VERSION);

    expect(await commands(project.uuid)).toHaveLength(4);
    expect(await emailsAbout(project.uuid)).toEqual([]);
  });

  it("leaves alone a project already on the new SDK, or on a newer one", async () => {
    const { project: current } = await projectOn(NEW_VERSION);
    const { project: newer } = await projectOn("0.10.1");

    await upgradeTo(NEW_VERSION);

    for (const project of [current, newer]) {
      expect(await commands(project.uuid)).toEqual([]);
      expect(await emailsAbout(project.uuid)).toEqual([]);
    }
  });

  it("leaves alone a project whose setup failed, which Rémi was already told about", async () => {
    const { db, project } = await projectOn("0.9.1");
    await db
      .update(projects)
      .set({ status: "setupFailed", setupStep: "build" })
      .where(eq(projects.id, project.id));

    await upgradeTo(NEW_VERSION);

    expect(await commands(project.uuid)).toEqual([]);
    expect(await emailsAbout(project.uuid)).toEqual([]);
  });

  it("leaves alone a project still setting up, whose first release isn't done", async () => {
    const { db, project } = await projectOn("0.9.1");
    await db
      .update(projects)
      .set({ status: "settingUp", setupStep: "build" })
      .where(eq(projects.id, project.id));

    await upgradeTo(NEW_VERSION);

    expect(await commands(project.uuid)).toEqual([]);
    expect(await emailsAbout(project.uuid)).toEqual([]);
  });

  it("upgrades a project on a pre-release of the new SDK", async () => {
    const { project } = await projectOn(`${NEW_VERSION}-beta.1`);

    await upgradeTo(NEW_VERSION);

    expect(await pushesToMain(project.uuid)).toHaveLength(1);
  });

  it("leaves alone a project on a pre-release of a newer SDK", async () => {
    const { project } = await projectOn("0.10.1-beta.1");

    await upgradeTo(NEW_VERSION);

    expect(await commands(project.uuid)).toEqual([]);
  });

  it("lists a project whose repo can't be read, and upgrades the others", async () => {
    const { project: withoutRepo } = await createProjectFixture(
      `upgrade-workflow-${crypto.randomUUID()}`,
    );
    const { project } = await projectOn("0.9.1");

    await upgradeTo(NEW_VERSION);

    const [email] = await emailsAbout(withoutRepo.uuid);
    expect(email?.text).toContain(`${withoutRepo.uuid}, whose repo couldn't be read`);
    expect(await pushesToMain(project.uuid)).toHaveLength(1);
  });

  it("upgrades at most a batch of projects at once, to throttle their deploys", async () => {
    const batch = await Promise.all(
      Array.from({ length: PROJECTS_PER_BATCH + 1 }, () => projectOn("0.9.1")),
    );
    const repos = batch.map(({ project }) => project.uuid);
    // Each build waits, so the upgrades that started stay running.
    for (const repo of repos) await fakes.hold(repo, "camox release --dry-run");
    const started = async () => {
      const runs = await Promise.all(repos.map((repo) => fakes.commandsRun(repo)));
      return runs.filter((projectRuns) => projectRuns.length > 0).length;
    };

    const upgrade = upgradeTo(NEW_VERSION);
    await vi.waitFor(async () => expect(await started()).toBeGreaterThan(0), { timeout: 10_000 });
    // Gives every project that could start the time to.
    await scheduler.wait(2_000);
    const startedAtOnce = await started();
    for (const repo of repos) await fakes.letGo(repo);
    await upgrade;

    expect(startedAtOnce).toBeLessThanOrEqual(PROJECTS_PER_BATCH);
    for (const repo of repos) expect(await pushesToMain(repo)).toHaveLength(1);
  });
});
