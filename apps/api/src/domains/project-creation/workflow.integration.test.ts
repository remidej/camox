import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture } from "../../../test/fixtures";
import { projects } from "../../schema";

// A new project's setup: the creation Workflow forks `template-default` into the project's repo,
// names the copy after the project, and pushes it to `main`, which starts its first release. The
// project is live once that release succeeds. Cloudflare Artifacts, its Git remotes, the release
// sandbox and email are faked at their bindings (test/release-fakes.js).

const fakes = (env as unknown as { RELEASE_FAKES: Fakes }).RELEASE_FAKES;

type Fakes = {
  commit(
    repo: string,
    files: Record<string, string | { symlink: string }>,
    message: string,
  ): Promise<string>;
  readFile(repo: string, ref: string, path: string): Promise<string | null>;
  readLink(repo: string, ref: string, path: string): Promise<string | null>;
  log(repo: string): Promise<{ oid: string; message: string }[]>;
  loseForkResponse(repo: string): Promise<void>;
  failForks(repo: string): Promise<void>;
  losePushResponse(repo: string): Promise<void>;
  failCommand(repo: string, pattern: string, times: number): Promise<void>;
  emailsSent(): Promise<{ to: string; subject: string; text: string; html: string }[]>;
};

// The Template's placeholder Project ID and its marker, as apps/template-default has them.
const PLACEHOLDER_ID = "01a15fff-627c-7e88-83cd-ceb11f804d47";

/** `template-default` as the Template refresh pushes it (packages/cli/src/lib/template.ts). */
const TEMPLATE = {
  "package.json": `${JSON.stringify({ name: "camox-template", private: true }, null, 2)}\n`,
  "pnpm-lock.yaml":
    "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      camox:\n        specifier: ^0.9.1\n        version: 0.9.1(react@19.3.1)\n",
  "vite.config.ts": `camox({\n  projectId: "${PLACEHOLDER_ID}", // camox-cli:replace-project-id\n}),\n`,
  "wrangler.jsonc": `{\n  "name": "${PLACEHOLDER_ID}", // camox-cli:replace-project-id\n  "main": "camox/worker",\n}\n`,
  "src/document.ts": `export default { title: "{{projectName}}" };\n`,
  "src/blocks/hero.tsx": `const title = "Let's get going on {{projectName}}";\n`,
  // apps/template-default links its agent skills from the SDK, which a clone doesn't install.
  ".agents/skills/camox": { symlink: "../../node_modules/camox/skills/camox" },
  ".claude/skills/camox": { symlink: "../../.agents/skills/camox" },
};

const TEMPLATE_COMMIT = "Update the Template to camox 0.9.1";

/** A project as creating it from the dashboard leaves it: setting up, its Template not copied. */
async function newProject(name = "Acme") {
  await fakes.commit("template-default", TEMPLATE, TEMPLATE_COMMIT);
  const fixture = await createProjectFixture(crypto.randomUUID());
  const project = await fixture.db
    .update(projects)
    .set({ name, status: "settingUp", setupStep: "copyTemplate" })
    .where(eq(projects.id, fixture.project.id))
    .returning()
    .get();
  return { ...fixture, project };
}

/** Runs the creation Workflow for `projectId`, as creating the project starts it. */
async function setUp(projectId: string, end: "complete" | "errored" = "complete") {
  await using instance = await introspectWorkflowInstance(env.PROJECT_CREATION_WORKFLOW, projectId);
  await instance.modify(async (m) => {
    await m.disableRetryDelays();
  });
  await env.PROJECT_CREATION_WORKFLOW.create({ id: projectId, params: { projectId } });
  await instance.waitForStatus(end);
}

/** The push to `main` the creation Workflow made, released as Cloudflare Artifacts' event does. */
async function releaseFirstPush(projectId: string, end: "complete" | "errored" = "complete") {
  const [head] = await fakes.log(projectId);
  const id = crypto.randomUUID();
  await using instance = await introspectWorkflowInstance(env.RELEASE_WORKFLOW, id);
  await instance.modify(async (m) => {
    await m.disableRetryDelays();
  });
  await env.RELEASE_WORKFLOW.create({
    id,
    params: {
      type: "cf.artifacts.repo.pushed",
      source: { type: "artifacts.repo", namespace: "projects", repoName: projectId },
      payload: {
        ref: "refs/heads/main",
        before: "0".repeat(40),
        after: head!.oid,
        commits: [
          {
            id: head!.oid,
            message: head!.message,
            author: { name: "Camox", email: "noreply@camox.ai" },
          },
        ],
      },
    },
  });
  await instance.waitForStatus(end);
}

async function statusOf(db: Awaited<ReturnType<typeof newProject>>["db"], id: number) {
  return db
    .select({ status: projects.status, setupStep: projects.setupStep })
    .from(projects)
    .where(eq(projects.id, id))
    .get();
}

/** The commits on a project's `main` that aren't the Template's. */
async function createCommits(projectId: string) {
  const log = await fakes.log(projectId);
  return log.filter(({ message }) => message !== TEMPLATE_COMMIT).map(({ message }) => message);
}

async function emailsAbout(projectId: string) {
  return (await fakes.emailsSent()).filter(({ text }) => text.includes(projectId));
}

describe("setting up a new project", () => {
  it("copies the Template into the project's repo, named after the project and pointed at its Project ID", async () => {
    const { project } = await newProject("Acme & Co");

    await setUp(project.uuid);

    const read = (path: string) => fakes.readFile(project.uuid, "main", path);
    expect(await read("wrangler.jsonc")).toBe(
      `{\n  "name": "${project.uuid}",\n  "main": "camox/worker",\n}\n`,
    );
    expect(await read("vite.config.ts")).toBe(`camox({\n  projectId: "${project.uuid}",\n}),\n`);
    expect(await read("src/document.ts")).toBe(`export default { title: "Acme & Co" };\n`);
    expect(await read("src/blocks/hero.tsx")).toBe(
      `const title = "Let's get going on Acme & Co";\n`,
    );
    expect(JSON.parse((await read("package.json"))!).name).toBe(project.slug);
    expect(await fakes.readLink(project.uuid, "main", ".claude/skills/camox")).toBe(
      "../../.agents/skills/camox",
    );
    const [created, template] = await fakes.log(project.uuid);
    expect(created?.message).toBe("Create Acme & Co");
    expect(template?.message).toBe(TEMPLATE_COMMIT);
  });

  it("keeps a name that would break the code's strings inside them", async () => {
    const { project } = await newProject('The "Best" \\ Site');

    await setUp(project.uuid);

    const document = await fakes.readFile(project.uuid, "main", "src/document.ts");
    expect(document).toBe(`export default { title: "The \\"Best\\" \\\\ Site" };\n`);
  });

  it("is still setting up, at the Building step, once the copy is pushed", async () => {
    const { db, project } = await newProject();

    await setUp(project.uuid);

    expect(await statusOf(db, project.id)).toEqual({ status: "settingUp", setupStep: "build" });
  });

  it("goes live after its first release succeeds", async () => {
    const { db, project } = await newProject();
    await setUp(project.uuid);

    await releaseFirstPush(project.uuid);

    expect(await statusOf(db, project.id)).toEqual({ status: "live", setupStep: null });
    expect(await emailsAbout(project.uuid)).toEqual([]);
  });

  it("doesn't fail when a retried fork finds the fork already made", async () => {
    const { db, project } = await newProject();
    await fakes.loseForkResponse(project.uuid);

    await setUp(project.uuid);

    expect(await statusOf(db, project.id)).toEqual({ status: "settingUp", setupStep: "build" });
    expect(await createCommits(project.uuid)).toEqual(["Create Acme"]);
  });

  it("doesn't push twice when a retried push finds the copy already pushed", async () => {
    const { db, project } = await newProject();
    await fakes.losePushResponse(project.uuid);

    await setUp(project.uuid);

    expect(await statusOf(db, project.id)).toEqual({ status: "settingUp", setupStep: "build" });
    expect(await createCommits(project.uuid)).toEqual(["Create Acme"]);
  });
});

describe("a setup that fails", () => {
  it("marks the project setupFailed at Copying the Template and emails one alert when copying gives up", async () => {
    const { db, project } = await newProject("Acme");
    await fakes.failForks(project.uuid);

    await setUp(project.uuid, "errored");

    expect(await statusOf(db, project.id)).toEqual({
      status: "setupFailed",
      setupStep: "copyTemplate",
    });
    const emails = await emailsAbout(project.uuid);
    expect(emails).toEqual([
      expect.objectContaining({ to: "alerts@camox.ai", subject: expect.stringContaining("Acme") }),
    ]);
    const [email] = emails;
    expect(email!.text).toContain("Failed step: Copying the Template\n");
    expect(email!.text).toContain(
      `https://dash.cloudflare.com/0123456789abcdef0123456789abcdef/workers/workflows/camox-project-creation/instance/${project.uuid}`,
    );
  });

  it("marks the project setupFailed at the step its first release gave up at", async () => {
    const { db, project } = await newProject();
    await setUp(project.uuid);
    await fakes.failCommand(project.uuid, "wrangler deploy", Infinity);

    await releaseFirstPush(project.uuid, "errored");

    expect(await statusOf(db, project.id)).toEqual({
      status: "setupFailed",
      setupStep: "serve",
    });
    expect(await emailsAbout(project.uuid)).toHaveLength(1);
  });

  it("marks a first release that gives up building at the Building step", async () => {
    const { db, project } = await newProject();
    await setUp(project.uuid);
    await fakes.failCommand(project.uuid, "camox release", Infinity);

    await releaseFirstPush(project.uuid, "errored");

    expect(await statusOf(db, project.id)).toEqual({ status: "setupFailed", setupStep: "build" });
  });

  it("leaves a live project live when a later release fails", async () => {
    const { db, project } = await newProject();
    await setUp(project.uuid);
    await releaseFirstPush(project.uuid);
    await fakes.failCommand(project.uuid, "wrangler deploy", Infinity);
    // A later push with a change: a push of the tree Live already serves releases nothing.
    await fakes.commit(project.uuid, { ...TEMPLATE, "src/blocks/cta.tsx": "" }, "Add a CTA");

    await releaseFirstPush(project.uuid, "errored");

    expect(await statusOf(db, project.id)).toEqual({ status: "live", setupStep: null });
  });
});
