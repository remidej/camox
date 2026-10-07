import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { assertSyncAccess, getAuthorizedProject } from "../../authorization";
import { runService } from "../../lib/run-service";
import { blocks, pages } from "../../schema";
import { getPageByPath, publishPage } from "./service";

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

  it("keeps published content stable while the draft changes", async () => {
    const { db, environment, layout, memberUser, project } =
      await createProjectFixture("lifecycle");
    const ctx = createServiceContext(db, memberUser);
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
        content: { title: "Published title" },
        summary: "",
        position: "a0",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returning()
      .get();

    await runService(publishPage(ctx, { id: page.id }));
    const publishedPage = await db.select().from(pages).where(eq(pages.id, page.id)).get();
    expect(publishedPage?.livePublishedCheckpointId).not.toBeNull();

    await db
      .update(blocks)
      .set({ content: { title: "Draft title" }, updatedAt: Date.now() })
      .where(eq(blocks.id, block.id));
    await db
      .update(pages)
      .set({ contentUpdatedAt: Date.now() + 1 })
      .where(eq(pages.id, page.id));

    const draft = await runService(
      getPageByPath(ctx, {
        projectSlug: project.slug,
        path: page.fullPath,
        source: "draft",
      }),
    );
    const live = await runService(
      getPageByPath(createServiceContext(db, null), {
        projectSlug: project.slug,
        path: page.fullPath,
        source: "live",
      }),
    );

    expect(draft.blocks[0].content).toEqual({ title: "Draft title" });
    expect(draft.page.status).toBe("modified");
    expect(live.blocks[0].content).toEqual({ title: "Published title" });
    expect(live.page.status).toBe("modified");

    const persisted = await env.DB.prepare("SELECT COUNT(*) AS count FROM page_checkpoints").first<{
      count: number;
    }>();
    expect(persisted?.count).toBe(1);
  });
});
