import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, layouts, pages } from "../../schema";
import {
  createPage,
  discardPageChanges,
  publishPage,
  setPageLayout,
  updatePage,
} from "../pages/service";
import { blocksOfLayout, layoutNamed } from "./identity";
import { getLayout, publishLayout, syncLayouts, unpublishLayout } from "./service";

async function setup(suffix: string) {
  const fixture = await createProjectFixture(suffix);
  const ctx = createServiceContext(fixture.db, fixture.memberUser);
  const definitions: Parameters<typeof syncLayouts>[1]["layouts"] = [
    { layoutId: "default", kind: "curated" as const, description: "", blocks: [] },
    { layoutId: "pokedex", kind: "singleton" as const, description: "", blocks: [] },
    { layoutId: "pokemon.$name", kind: "derived" as const, description: "", blocks: [] },
  ];
  const sync = (defs = definitions) =>
    runService(
      syncLayouts(createServiceContext(fixture.db, null), {
        projectSlug: fixture.project.slug,
        deployToken: "test-deploy-token",
        autoCreate: false,
        layouts: defs,
      }),
    );
  return { ...fixture, ctx, definitions, sync };
}

describe("singleton page ownership", () => {
  it("syncs kinds and prevents curated creation, layout assignment, and URL moves", async () => {
    const { db, ctx, project, layout, sync } = await setup("singleton-ownership");
    const result = await sync();
    const singleton = result.layouts.find((item) => item.layout.kind === "singleton")!.layout;
    const derived = result.layouts.find((item) => item.layout.kind === "derived")!.layout;
    expect(await db.select().from(pages).where(eq(pages.projectId, project.id))).toEqual([]);
    for (const record of [singleton, derived]) {
      await expect(
        runService(
          createPage(ctx, {
            projectId: project.id,
            layoutId: record.layoutId,
            pathSegment: "other",
          }),
        ),
      ).rejects.toMatchObject({ status: 400 });
    }
    for (const pathSegment of ["pokedex", "%70okedex", "pokedex/"]) {
      await expect(
        runService(
          createPage(ctx, { projectId: project.id, layoutId: layout.layoutId, pathSegment }),
        ),
      ).rejects.toMatchObject({ status: 409 });
    }
    const { page } = await runService(
      createPage(ctx, {
        projectId: project.id,
        layoutId: layout.layoutId,
        pathSegment: "about",
      }),
    );
    await expect(
      runService(setPageLayout(ctx, { id: page.id, layoutId: singleton.layoutId })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      runService(updatePage(ctx, { id: page.id, pathSegment: "pokedex" })),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect((await db.select().from(pages).where(eq(pages.id, page.id)).get())?.fullPath).toBe(
      "/about",
    );
  });

  it("rejects existing URL and layout-use collisions before changing definitions", async () => {
    const { ctx, project, layout, db, definitions, sync } = await setup("singleton-collision");
    await runService(
      createPage(ctx, { projectId: project.id, layoutId: layout.layoutId, pathSegment: "pokedex" }),
    );
    await expect(sync()).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(layouts).where(eq(layouts.projectId, project.id))).toHaveLength(
      1,
    );
    await expect(sync([{ ...definitions[0], kind: "singleton" }])).rejects.toMatchObject({
      status: 409,
    });
    expect(
      (
        await db
          .select()
          .from(layouts)
          .where(layoutNamed(layout.environmentId, layout.layoutId))
          .get()
      )?.kind,
    ).toBe("curated");
  });

  it("protects nested singleton paths when moving an ancestor and restoring a published page", async () => {
    const { ctx, project, layout, definitions, sync, db } = await setup("singleton-moves");
    const { page: parent } = await runService(
      createPage(ctx, {
        projectId: project.id,
        layoutId: layout.layoutId,
        pathSegment: "old",
      }),
    );
    const { page: child } = await runService(
      createPage(ctx, {
        projectId: project.id,
        layoutId: layout.layoutId,
        pathSegment: "pokedex",
        parentPageId: parent.id,
      }),
    );
    const { page: legacy } = await runService(
      createPage(ctx, {
        projectId: project.id,
        layoutId: layout.layoutId,
        pathSegment: "pokedex",
      }),
    );
    await runService(publishPage(ctx, { id: legacy.id }));
    await runService(updatePage(ctx, { id: legacy.id, pathSegment: "legacy" }));
    await sync([...definitions, { ...definitions[1], layoutId: "guide.pokedex" }]);
    await expect(
      runService(updatePage(ctx, { id: parent.id, pathSegment: "guide" })),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect((await db.select().from(pages).where(eq(pages.id, child.id)).get())?.fullPath).toBe(
      "/old/pokedex",
    );
    await expect(runService(discardPageChanges(ctx, { id: legacy.id }))).rejects.toMatchObject({
      status: 409,
    });
    await runService(updatePage(ctx, { id: parent.id, pathSegment: "new" }));
    expect((await db.select().from(pages).where(eq(pages.id, child.id)).get())?.fullPath).toBe(
      "/new/pokedex",
    );
  });

  it("publishes only singleton blocks, keeps drafts private, and releases removed routes", async () => {
    const { ctx, project, layout, definitions, sync, db } = await setup("singleton-publishing");
    const result = await sync([
      definitions[0],
      {
        ...definitions[1],
        blocks: [{ type: "intro", slot: "before" as const, content: { title: "Published" } }],
      },
    ]);
    const singleton = result.layouts.find((item) => item.layout.kind === "singleton")!.layout;
    const publicCtx = createServiceContext(db, null);
    const input = { projectSlug: project.slug, layoutId: "pokedex" };
    await expect(
      runService(getLayout(publicCtx, { ...input, source: "draft" })),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect((await runService(getLayout(publicCtx, input))).blocks).toEqual([]);
    await runService(publishLayout(ctx, { projectId: project.id, layoutId: singleton.layoutId }));
    await db
      .update(blocks)
      .set({ content: { title: "Draft" } })
      .where(blocksOfLayout(singleton));
    expect((await runService(getLayout(publicCtx, input))).blocks[0].content).toEqual({
      title: "Published",
    });
    expect(
      (await runService(getLayout(ctx, { ...input, source: "draft" }))).blocks[0].content,
    ).toEqual({
      title: "Draft",
    });
    await runService(unpublishLayout(ctx, { projectId: project.id, layoutId: singleton.layoutId }));
    expect((await runService(getLayout(publicCtx, input))).blocks).toEqual([]);
    expect(await db.select().from(pages).where(eq(pages.projectId, project.id))).toEqual([]);
    await sync([definitions[0]]);
    await expect(
      runService(
        createPage(ctx, {
          projectId: project.id,
          layoutId: layout.layoutId,
          pathSegment: "pokedex",
        }),
      ),
    ).resolves.toMatchObject({ fullPath: "/pokedex" });
  });
});
