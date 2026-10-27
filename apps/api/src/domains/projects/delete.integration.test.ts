import { call } from "@orpc/server";
import { introspectWorkflow } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";
import { layouts, locales, projects } from "../../schema";
import type { Bindings } from "../../types";

const fakes = (env as unknown as { RELEASE_FAKES: Fakes }).RELEASE_FAKES;

type Fakes = { emailsSent(): Promise<{ subject: string; text: string }[]> };

// Deleting a project from the dashboard: during the request, the API removes the project's rows
// and its hosts, `<slug>.camox.site` and any Custom Domain, so the site goes offline at once, then starts the deletion
// Workflow, which cleans up its Worker and repo.

/**
 * A project its organization's member deletes, while the deletion Workflow's steps do nothing:
 * what they do is the deletion Workflow's tests' concern. Disposing of `deletions` forgets the
 * deletion Workflow's instances, so each test holds it until it ends.
 */
async function deleteAsMember({ customDomain }: { customDomain?: string } = {}) {
  const fixture = await createProjectFixture(crypto.randomUUID());
  await env.PROJECT_SLUGS.put(fixture.project.slug, fixture.project.uuid);
  if (customDomain) {
    // As an operator sets a Custom Domain (apps/dispatch/README.md).
    await fixture.db
      .update(projects)
      .set({ customDomain })
      .where(eq(projects.id, fixture.project.id));
    await env.PROJECT_SLUGS.put(customDomain, fixture.project.uuid);
  }
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

  it("takes its Custom Domain offline at once", async () => {
    const customDomain = `${crypto.randomUUID()}.example`;
    const { deletions } = await deleteAsMember({ customDomain });
    await using _ = deletions;

    expect(await env.PROJECT_SLUGS.get(customDomain)).toBeNull();
  });

  it("starts cleaning up its Worker and repo, named after its Project ID", async () => {
    const { project, deletions } = await deleteAsMember();
    await using _ = deletions;

    const instance = await env.PROJECT_DELETION_WORKFLOW.get(project.uuid);
    expect(instance.id).toBe(project.uuid);
  });

  it("alerts Rémi, naming what's left behind, when its cleanup can't start", async () => {
    const { db, project, memberUser } = await createProjectFixture(crypto.randomUUID());
    await db.update(projects).set({ name: "Acme" }).where(eq(projects.id, project.id));
    const member = createRpcContext(db, memberUser);
    const context = {
      ...member,
      env: {
        ...member.env,
        PROJECT_DELETION_WORKFLOW: {
          create: () => Promise.reject(new Error("Workflows are down")),
          get: (id: string) => env.PROJECT_DELETION_WORKFLOW.get(id),
        } as unknown as Bindings["PROJECT_DELETION_WORKFLOW"],
      },
    };

    await call(router.projects.delete, { id: project.id }, { context });

    const emails = (await fakes.emailsSent()).filter(({ text }) => text.includes(project.uuid));
    expect(emails).toEqual([expect.objectContaining({ subject: "Cleanup failed: Acme" })]);
    expect(emails[0]!.text).toContain(`Project ID: ${project.uuid}\n`);
    expect(emails[0]!.text).toContain(
      `Left behind: Worker ${project.uuid}, repo ${project.uuid}\n`,
    );
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
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await env.PROJECT_SLUGS.get(project.slug)).toBe(project.uuid);
  });
});
