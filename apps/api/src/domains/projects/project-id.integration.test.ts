import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";

/** A lowercase UUIDv7, the only form a Project ID takes. */
const LOWERCASE_UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("Project ID", () => {
  it("is minted as a lowercase UUIDv7 when a project is created", async () => {
    const { db, memberUser, project } = await createProjectFixture("project-id-create");
    const context = createRpcContext(db, memberUser);

    const created = await call(
      router.projects.create,
      {
        name: "New project",
        slug: "project-id-create-new",
        organizationId: project.organizationId,
      },
      { context },
    );

    expect(created.uuid).toMatch(LOWERCASE_UUIDV7);
  });

  it("is returned with the project's name and slug when the project is loaded", async () => {
    const { db, memberUser, project } = await createProjectFixture("project-id-load");
    const context = createRpcContext(db, memberUser);
    const created = await call(
      router.projects.create,
      {
        name: "Loaded project",
        slug: "project-id-load-new",
        organizationId: project.organizationId,
      },
      { context },
    );
    const expected = { uuid: created.uuid, name: "Loaded project", slug: "project-id-load-new" };

    const bySlug = await call(router.projects.getBySlug, { slug: created.slug }, { context });
    const byId = await call(router.projects.get, { id: created.id }, { context });

    expect(bySlug).toMatchObject(expected);
    expect(byId).toMatchObject(expected);
  });
});
