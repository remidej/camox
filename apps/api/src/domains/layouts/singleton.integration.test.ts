import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import {
  createProjectFixture,
  createServiceContext,
  seedLiveThrough,
  inScope,
  syncDefinitionSet,
  type TestDefinitionSet,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, layouts, pages } from "../../schema";
import { createPage, listPages, setPageLayout, updatePage } from "../pages/service";
import { blocksOfLayout, layoutNamed } from "./identity";
import { getLayout } from "./service";

async function setup(suffix: string) {
  const fixture = await createProjectFixture(suffix);
  const ctx = createServiceContext(fixture.db, fixture.memberUser);
  const definitions: NonNullable<TestDefinitionSet["layouts"]> = [
    { layoutId: "default", kind: "curated" as const, description: "", blocks: [] },
    { layoutId: "pokedex", kind: "singleton" as const, description: "", blocks: [] },
    { layoutId: "pokemon.$name", kind: "derived" as const, description: "", blocks: [] },
  ];
  // The block definitions Live holds, which every release sends alongside its layouts.
  const blockDefinitions: NonNullable<TestDefinitionSet["blocks"]> = [];
  const define = (definition: (typeof blockDefinitions)[number]) => {
    blockDefinitions.push(definition);
    return syncDefinitionSet(fixture.db, fixture.project, { blocks: blockDefinitions });
  };
  const sync = (defs = definitions) =>
    syncDefinitionSet(fixture.db, fixture.project, { blocks: blockDefinitions, layouts: defs });
  return { ...fixture, ctx, definitions, define, sync };
}

describe("singleton page ownership", () => {
  it("syncs kinds and prevents curated creation, layout assignment, and URL moves", async () => {
    const { db, ctx, project, layout, sync } = await setup("singleton-ownership");
    await sync();
    const singleton = { projectId: project.id, layoutId: "pokedex" };
    const derived = { projectId: project.id, layoutId: "pokemon.$name" };
    expect(await db.select().from(pages).where(eq(pages.projectId, project.id))).toEqual([]);
    for (const record of [singleton, derived]) {
      await expect(
        seedLiveThrough(ctx, project.id, (draft) =>
          createPage(inScope(ctx, draft), {
            projectId: project.id,
            layoutId: record.layoutId,
            pathSegment: "other",
          }),
        ),
      ).rejects.toMatchObject({ status: 400 });
    }
    for (const pathSegment of ["pokedex", "%70okedex", "pokedex/"]) {
      await expect(
        seedLiveThrough(ctx, project.id, (draft) =>
          createPage(inScope(ctx, draft), {
            projectId: project.id,
            layoutId: layout.layoutId,
            pathSegment,
          }),
        ),
      ).rejects.toMatchObject({ status: 409 });
    }
    const { page } = await seedLiveThrough(ctx, project.id, (draft) =>
      createPage(inScope(ctx, draft), {
        projectId: project.id,
        layoutId: layout.layoutId,
        pathSegment: "about",
      }),
    );
    await expect(
      seedLiveThrough(ctx, project.id, (draft) =>
        setPageLayout(inScope(ctx, draft), { id: page.id, layoutId: singleton.layoutId }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      seedLiveThrough(ctx, project.id, (draft) =>
        updatePage(inScope(ctx, draft), { id: page.id, pathSegment: "pokedex" }),
      ),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect((await db.select().from(pages).where(eq(pages.id, page.id)).get())?.fullPath).toBe(
      "/about",
    );
  });

  it("syncs over existing URL and layout-use collisions, which content never blocks", async () => {
    const { ctx, project, layout, db, definitions, sync } = await setup("singleton-collision");
    await seedLiveThrough(ctx, project.id, (draft) =>
      createPage(inScope(ctx, draft), {
        projectId: project.id,
        layoutId: layout.layoutId,
        pathSegment: "pokedex",
      }),
    );
    await sync();
    expect(await db.select().from(layouts).where(eq(layouts.projectId, project.id))).toHaveLength(
      3,
    );
    expect(
      await runService(listPages(inScope(ctx, null), { projectId: project.id })),
    ).toMatchObject([{ fullPath: "/pokedex", shadowed: true, needsLayout: false }]);
    await sync([{ ...definitions[0], kind: "singleton" }]);
    expect(
      (await db.select().from(layouts).where(layoutNamed(layout.projectId, layout.layoutId)).get())
        ?.kind,
    ).toBe("singleton");
    expect(
      await runService(listPages(inScope(ctx, null), { projectId: project.id })),
    ).toMatchObject([{ fullPath: "/pokedex", needsLayout: true }]);
  });

  it("protects nested singleton paths when moving an ancestor", async () => {
    const { ctx, project, layout, definitions, sync, db } = await setup("singleton-moves");
    const { page: parent } = await seedLiveThrough(ctx, project.id, (draft) =>
      createPage(inScope(ctx, draft), {
        projectId: project.id,
        layoutId: layout.layoutId,
        pathSegment: "old",
      }),
    );
    const { page: child } = await seedLiveThrough(ctx, project.id, (draft) =>
      createPage(inScope(ctx, draft), {
        projectId: project.id,
        layoutId: layout.layoutId,
        pathSegment: "pokedex",
        parentPageId: parent.id,
      }),
    );
    await sync([...definitions, { ...definitions[1], layoutId: "guide.pokedex" }]);
    await expect(
      seedLiveThrough(ctx, project.id, (draft) =>
        updatePage(inScope(ctx, draft), { id: parent.id, pathSegment: "guide" }),
      ),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect((await db.select().from(pages).where(eq(pages.id, child.id)).get())?.fullPath).toBe(
      "/old/pokedex",
    );
    await seedLiveThrough(ctx, project.id, (draft) =>
      updatePage(inScope(ctx, draft), { id: parent.id, pathSegment: "new" }),
    );
    expect((await db.select().from(pages).where(eq(pages.id, child.id)).get())?.fullPath).toBe(
      "/new/pokedex",
    );
  });

  it("serves current singleton blocks to everyone and releases removed routes", async () => {
    const { ctx, project, layout, definitions, define, sync, db } = await setup("singleton-reads");
    await define({
      blockId: "intro",
      title: "Intro",
      description: "",
      contentSchema: { type: "object", properties: { title: { type: "string" } } },
    });
    await sync([
      definitions[0],
      {
        ...definitions[1],
        blocks: [{ type: "intro", slot: "before" as const, content: { title: "First" } }],
      },
    ]);
    const singleton = { projectId: project.id, layoutId: "pokedex" };
    const input = { projectUuid: project.uuid, layoutId: "pokedex" };
    await db
      .update(blocks)
      .set({ content: { title: "Edited" } })
      .where(blocksOfLayout(singleton));
    for (const reader of [createServiceContext(db, null), ctx]) {
      expect((await runService(getLayout(inScope(reader, null), input))).blocks[0].content).toEqual(
        {
          title: "Edited",
        },
      );
    }
    expect(await db.select().from(pages).where(eq(pages.projectId, project.id))).toEqual([]);
    await sync([definitions[0]]);
    await expect(
      seedLiveThrough(ctx, project.id, (draft) =>
        createPage(inScope(ctx, draft), {
          projectId: project.id,
          layoutId: layout.layoutId,
          pathSegment: "pokedex",
        }),
      ),
    ).resolves.toMatchObject({ fullPath: "/pokedex" });
  });
});
