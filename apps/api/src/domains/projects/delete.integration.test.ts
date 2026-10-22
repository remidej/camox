import { call } from "@orpc/server";
import { introspectWorkflow } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";
import { layouts, locales, projects } from "../../schema";

// Deleting a project from the dashboard: during the request, the API removes the project's rows
// and its `<slug>.camox.site` host, so the site goes offline at once, then starts the deletion
// Workflow, which cleans up its Worker and repo.

/**
 * A project its organization's member deletes, while the deletion Workflow's steps do nothing:
 * what they do is the deletion Workflow's tests' concern. Disposing of `deletions` forgets the
 * deletion Workflow's instances, so each test holds it until it ends.
 */
async function deleteAsMember() {
  const fixture = await createProjectFixture(crypto.randomUUID());
  await env.PROJECT_SLUGS.put(fixture.project.slug, fixture.project.uuid);
  const context = createRpcContext(fixture.db, fixture.memberUser);
  const deletions = await introspectWorkflow(env.PROJECT_DELETION_WORKFLOW);
  await deletions.modifyAll(async (m) => {
    await m.mockStepResult({ name: "stop the setup" }, null);
    await m.mockStepResult({ name: "delete the Worker" }, null);
    await m.mockStepResult({ name: "delete the repo" }, null);
  });
  await call(router.projects.delete, { id: fixture.project.id }, { context });
  return { ...fixture, deletions };
}

describe("deleting a project", () => {
  it("removes its rows at once", async () => {
    const { db, project, deletions } = await deleteAsMember();
    await using _ = deletions;

    expect(await db.select().from(projects).where(eq(projects.id, project.id))).toEqual([]);
    expect(await db.select().from(layouts).where(eq(layouts.projectId, project.id))).toEqual([]);
    expect(await db.select().from(locales).where(eq(locales.projectId, project.id))).toEqual([]);
  });

  it("takes its camox.site host offline at once", async () => {
    const { project, deletions } = await deleteAsMember();
    await using _ = deletions;

    expect(await env.PROJECT_SLUGS.get(project.slug)).toBeNull();
  });

  it("starts cleaning up its Worker and repo, named after its Project ID", async () => {
    const { project, deletions } = await deleteAsMember();
    await using _ = deletions;

    const instance = await env.PROJECT_DELETION_WORKFLOW.get(project.uuid);
    expect(instance.id).toBe(project.uuid);
  });

  it("refuses someone outside its organization, leaving its host up", async () => {
    const { db, project, outsiderUser } = await createProjectFixture(crypto.randomUUID());
    await env.PROJECT_SLUGS.put(project.slug, project.uuid);

    await expect(
      call(
        router.projects.delete,
        { id: project.id },
        { context: createRpcContext(db, outsiderUser) },
      ),
    ).rejects.toThrow();

    expect(await env.PROJECT_SLUGS.get(project.slug)).toBe(project.uuid);
  });
});
