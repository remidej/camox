import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { assertSyncAccess, getAuthorizedProject } from "../../authorization";
import { runService } from "../../lib/run-service";
import { blocks, pages } from "../../schema";
import { updateBlockContent } from "../blocks/service";
import { getPageByPath } from "./service";

describe("page persistence", () => {
  it("enforces tenant and environment boundaries with a real local D1 database", async () => {
    const { db, memberUser, outsiderUser, project } = await createProjectFixture("auth");

    await expect(
      runService(getAuthorizedProject(db, project.id, memberUser.id)),
    ).resolves.toMatchObject({
      id: project.id,
    });
    await expect(
      runService(getAuthorizedProject(db, project.id, outsiderUser.id)),
    ).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      runService(
        assertSyncAccess(db, project.slug, {
          user: null,
          environmentName: "production",
          deployToken: "test-deploy-token",
        }),
      ),
    ).resolves.toMatchObject({ id: project.id });
    await expect(
      runService(
        assertSyncAccess(db, project.slug, {
          user: null,
          environmentName: "dev:member@example.com",
          deployToken: "test-deploy-token",
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns a page's current rows to visitors and members alike", async () => {
    const { db, environment, layout, memberUser, project } = await createProjectFixture("current");
    const memberCtx = createServiceContext(db, memberUser);
    const visitorCtx = createServiceContext(db, null);
    const page = await db
      .insert(pages)
      .values({
        projectId: project.id,
        environmentId: environment.id,
        pathSegment: "about",
        fullPath: "/about",
        layoutId: layout.id,
        nickname: "About",
        contentUpdatedAt: Date.now(),
        createdById: memberUser.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returning()
      .get();
    const block = await db
      .insert(blocks)
      .values({
        pageId: page.id,
        type: "hero",
        content: { title: "First title" },
        summary: "",
        position: "a0",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returning()
      .get();
    const read = (ctx: typeof memberCtx) =>
      runService(getPageByPath(ctx, { projectSlug: project.slug, path: page.fullPath }));

    expect((await read(visitorCtx)).blocks[0].content).toEqual({ title: "First title" });

    // An edit is visible right away, whoever reads.
    await runService(updateBlockContent(memberCtx, { id: block.id, content: { title: "Edited" } }));

    for (const ctx of [visitorCtx, memberCtx]) {
      const view = await read(ctx);
      expect(view.blocks[0].content).toEqual({ title: "Edited" });
      expect(view.page).not.toHaveProperty("status");
    }
  });
});
