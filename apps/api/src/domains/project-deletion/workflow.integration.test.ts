import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";

// A deleted project's cleanup: once the request has removed its rows and its host, the deletion
// Workflow deletes its Worker from the `production` dispatch namespace and its repo. Cloudflare
// Artifacts, the Cloudflare API and email are faked (test/release-fakes.js).

const fakes = (env as unknown as { RELEASE_FAKES: Fakes }).RELEASE_FAKES;

type Fakes = {
  commit(repo: string, files: Record<string, string>, message: string): Promise<string>;
  hasRepo(repo: string): Promise<boolean>;
  deployWorker(name: string): Promise<void>;
  hasWorker(name: string): Promise<boolean>;
  failWorkerDeletions(name: string): Promise<void>;
  failForks(repo: string): Promise<void>;
  emailsSent(): Promise<{ to: string; subject: string; text: string; html: string }[]>;
};

/** A deleted project's Project ID, whose repo and Worker are still there. */
async function deletedProject() {
  const projectId = crypto.randomUUID();
  await fakes.commit(projectId, { "package.json": "{}\n" }, "Create Acme");
  await fakes.deployWorker(projectId);
  return projectId;
}

/** Runs the deletion Workflow for `projectId`, as deleting the project starts it. */
async function cleanUp(projectId: string, end: "complete" | "errored" = "complete") {
  await using instance = await introspectWorkflowInstance(env.PROJECT_DELETION_WORKFLOW, projectId);
  await instance.modify(async (m) => {
    await m.disableRetryDelays();
  });
  await env.PROJECT_DELETION_WORKFLOW.create({
    id: projectId,
    params: { projectId, name: "Acme" },
  });
  await instance.waitForStatus(end);
}

async function emailsAbout(projectId: string) {
  return (await fakes.emailsSent()).filter(({ text }) => text.includes(projectId));
}

describe("cleaning up a deleted project", () => {
  it("deletes its Worker and its repo", async () => {
    const projectId = await deletedProject();

    await cleanUp(projectId);

    expect(await fakes.hasWorker(projectId)).toBe(false);
    expect(await fakes.hasRepo(projectId)).toBe(false);
    expect(await emailsAbout(projectId)).toEqual([]);
  });

  it("stops its setup if it's still underway, so the setup can't fork its repo again", async () => {
    const projectId = await deletedProject();
    // Every fork fails, so the setup waits to retry, with the retry delays of production.
    await fakes.failForks(projectId);
    const setup = await env.PROJECT_CREATION_WORKFLOW.create({
      id: projectId,
      params: { projectId },
    });

    await cleanUp(projectId);

    expect((await setup.status()).status).toBe("terminated");
  });

  it("succeeds when its Worker was never deployed nor its repo forked", async () => {
    const projectId = crypto.randomUUID();

    await cleanUp(projectId);

    expect(await emailsAbout(projectId)).toEqual([]);
  });
});

describe("a cleanup that gives up", () => {
  it("emails one alert naming the project, its Project ID and the step that failed", async () => {
    const projectId = await deletedProject();
    await fakes.failWorkerDeletions(projectId);

    await cleanUp(projectId, "errored");

    const emails = await emailsAbout(projectId);
    expect(emails).toEqual([
      expect.objectContaining({ to: "alerts@camox.dev", subject: expect.stringContaining("Acme") }),
    ]);
    const [email] = emails;
    expect(email!.text).toContain(`Project ID: ${projectId}\n`);
    expect(email!.text).toContain("Failed step: Deleting the Worker\n");
    expect(email!.text).toContain(`Left behind: Worker ${projectId}\n`);
    expect(email!.text).toContain(
      `https://dash.cloudflare.com/0123456789abcdef0123456789abcdef/workers/workflows/camox-project-deletion/instance/${projectId}`,
    );
  });

  it("still deletes its repo when deleting its Worker gives up", async () => {
    const projectId = await deletedProject();
    await fakes.failWorkerDeletions(projectId);

    await cleanUp(projectId, "errored");

    expect(await fakes.hasWorker(projectId)).toBe(true);
    expect(await fakes.hasRepo(projectId)).toBe(false);
  });
});
