import { call } from "@orpc/server";
import { introspectWorkflow } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";
import { projects } from "../../schema";

// Creating a project from the dashboard: the API refuses slugs it can't give, then records the
// project as setting up, maps its `<slug>.camox.site` host to its Project ID, and starts the
// creation Workflow, which copies the Template into its repo.

/**
 * Creates a project as a member of the fixture's organization, while the creation Workflow's
 * steps do nothing: what they do is the creation Workflow's tests' concern.
 */
async function createAsMember(slug: string, name = "Acme") {
  const fixture = await createProjectFixture(crypto.randomUUID());
  const context = createRpcContext(fixture.db, fixture.memberUser);
  await using creations = await introspectWorkflow(env.PROJECT_CREATION_WORKFLOW);
  await creations.modifyAll(async (m) => {
    await m.mockStepResult({ name: "fork the Template" }, null);
    await m.mockStepResult({ name: "commit the project's code" }, null);
  });
  const create = () =>
    call(
      router.projects.create,
      { name, slug, organizationId: fixture.project.organizationId },
      { context },
    );
  return { ...fixture, context, create };
}

function uniqueSlug() {
  return `acme-${crypto.randomUUID().slice(0, 8)}`;
}

describe("creating a project", () => {
  it("records it as setting up, with a Deploy Token, at the Copying the Template step", async () => {
    const slug = uniqueSlug();
    const { db, create } = await createAsMember(slug);

    const created = await create();

    const row = await db.select().from(projects).where(eq(projects.slug, slug)).get();
    expect(row).toMatchObject({
      uuid: created.uuid,
      name: "Acme",
      status: "settingUp",
      setupStep: "copyTemplate",
    });
    expect(row!.deployToken).not.toBe("");
  });

  it("maps its camox.site host to its Project ID", async () => {
    const slug = uniqueSlug();
    const { create } = await createAsMember(slug);

    const created = await create();

    expect(await env.PROJECT_SLUGS.get(slug)).toBe(created.uuid);
  });

  it("starts the creation Workflow, named after its Project ID", async () => {
    const { create } = await createAsMember(uniqueSlug());

    const created = await create();

    const instance = await env.PROJECT_CREATION_WORKFLOW.get(created.uuid);
    expect(instance.id).toBe(created.uuid);
  });

  it("refuses a reserved slug with a clear message, creating nothing", async () => {
    const { db, create } = await createAsMember("dashboard");

    await expect(create()).rejects.toThrow("This slug is reserved by Camox. Choose another.");

    expect(await db.select().from(projects).where(eq(projects.slug, "dashboard"))).toEqual([]);
    expect(await env.PROJECT_SLUGS.get("dashboard")).toBeNull();
  });

  it("refuses a slug another project has, with a clear message", async () => {
    const { db, project: existing } = await createProjectFixture(crypto.randomUUID());
    await env.PROJECT_SLUGS.put(existing.slug, existing.uuid);
    const { create } = await createAsMember(existing.slug);

    await expect(create()).rejects.toThrow("This slug is already taken. Choose another.");

    expect(await db.select().from(projects).where(eq(projects.slug, existing.slug))).toHaveLength(
      1,
    );
    expect(await env.PROJECT_SLUGS.get(existing.slug)).toBe(existing.uuid);
  });

  it("refuses a slug that isn't one lowercase DNS label", async () => {
    const { db, create } = await createAsMember("Acme.Site");

    await expect(create()).rejects.toThrow(/lowercase letters, digits and hyphens/);

    expect(await db.select().from(projects).where(eq(projects.slug, "Acme.Site"))).toEqual([]);
  });
});

describe("checking a slug's availability", () => {
  async function check(slug: string) {
    const { db, memberUser } = await createProjectFixture(crypto.randomUUID());
    return call(
      router.projects.checkSlugAvailability,
      { slug },
      { context: createRpcContext(db, memberUser) },
    );
  }

  it("tells a free slug apart from a reserved, a taken and a malformed one", async () => {
    const { project: existing } = await createProjectFixture(crypto.randomUUID());

    expect(await check(uniqueSlug())).toEqual({ available: true });
    expect(await check("www")).toEqual({ available: false, reason: "reserved" });
    expect(await check(existing.slug)).toEqual({ available: false, reason: "taken" });
    expect(await check("-acme")).toEqual({ available: false, reason: "invalid" });
  });
});
