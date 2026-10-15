import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, layouts, pages } from "../../schema";
import { createPage, setPageLayout, updatePage } from "../pages/service";
import { getLayout, syncLayouts } from "./service";

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
          createPage(ctx, { projectId: project.id, layoutId: record.id, pathSegment: "other" }),
        ),
      ).rejects.toMatchObject({ status: 400 });
    }
    for (const pathSegment of ["pokedex", "%70okedex", "pokedex/"]) {
      await expect(
        runService(createPage(ctx, { projectId: project.id, layoutId: layout.id, pathSegment })),
      ).rejects.toMatchObject({ status: 409 });
    }
    const { page } = await runService(
      createPage(ctx, {
        projectId: project.id,
        layoutId: layout.id,
        pathSegment: "about",
      }),
    );
    await expect(
      runService(setPageLayout(ctx, { id: page.id, layoutId: singleton.id })),
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
      createPage(ctx, { projectId: project.id, layoutId: layout.id, pathSegment: "pokedex" }),
    );
    await expect(sync()).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(layouts).where(eq(layouts.projectId, project.id))).toHaveLength(
      1,
    );
    await expect(sync([{ ...definitions[0], kind: "singleton" }])).rejects.toMatchObject({
      status: 409,
    });
    expect((await db.select().from(layouts).where(eq(layouts.id, layout.id)).get())?.kind).toBe(
      "curated",
    );
  });

  it("protects nested singleton paths when moving an ancestor", async () => {
    const { ctx, project, layout, definitions, sync, db } = await setup("singleton-moves");
    const { page: parent } = await runService(
      createPage(ctx, {
        projectId: project.id,
        layoutId: layout.id,
        pathSegment: "old",
      }),
    );
    const { page: child } = await runService(
      createPage(ctx, {
        projectId: project.id,
        layoutId: layout.id,
        pathSegment: "pokedex",
        parentPageId: parent.id,
      }),
    );
    await sync([...definitions, { ...definitions[1], layoutId: "guide.pokedex" }]);
    await expect(
      runService(updatePage(ctx, { id: parent.id, pathSegment: "guide" })),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect((await db.select().from(pages).where(eq(pages.id, child.id)).get())?.fullPath).toBe(
      "/old/pokedex",
    );
    await runService(updatePage(ctx, { id: parent.id, pathSegment: "new" }));
    expect((await db.select().from(pages).where(eq(pages.id, child.id)).get())?.fullPath).toBe(
      "/new/pokedex",
    );
  });

  it("serves current singleton blocks to everyone and releases removed routes", async () => {
    const { ctx, project, layout, definitions, sync, db } = await setup("singleton-reads");
    const result = await sync([
      definitions[0],
      {
        ...definitions[1],
        blocks: [{ type: "intro", slot: "before" as const, content: { title: "First" } }],
      },
    ]);
    const singleton = result.layouts.find((item) => item.layout.kind === "singleton")!.layout;
    const input = { projectSlug: project.slug, layoutId: "pokedex" };
    await db
      .update(blocks)
      .set({ content: { title: "Edited" } })
      .where(eq(blocks.layoutId, singleton.id));
    for (const reader of [createServiceContext(db, null), ctx]) {
      expect((await runService(getLayout(reader, input))).blocks[0].content).toEqual({
        title: "Edited",
      });
    }
    expect(await db.select().from(pages).where(eq(pages.projectId, project.id))).toEqual([]);
    await sync([definitions[0]]);
    await expect(
      runService(
        createPage(ctx, { projectId: project.id, layoutId: layout.id, pathSegment: "pokedex" }),
      ),
    ).resolves.toMatchObject({ fullPath: "/pokedex" });
  });
});
