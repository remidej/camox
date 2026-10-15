import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, environments, files, layouts, pages, repeatableItems } from "../../schema";
import { callTool } from "../agent/service";
import { getLayout } from "./service";

describe("standalone shared layout reads", () => {
  it("loads ordered layout blocks, nested items and files without creating a page", async () => {
    const { db, environment, layout, memberUser, project } =
      await createProjectFixture("layout-view");
    const ctx = createServiceContext(db, memberUser);
    const now = Date.now();
    const file = await db
      .insert(files)
      .values({
        projectId: project.id,
        environmentId: environment.id,
        url: "https://example.com/logo.png",
        filename: "logo.png",
        mimeType: "image/png",
        size: 1,
        blobId: "logo",
        path: "logo.png",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const footer = await db
      .insert(blocks)
      .values({
        environmentId: environment.id,
        layoutId: layout.layoutId,
        type: "footer",
        slot: "after",
        content: { title: "Footer" },
        position: "a1",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const navbar = await db
      .insert(blocks)
      .values({
        environmentId: environment.id,
        layoutId: layout.layoutId,
        type: "navbar",
        slot: "before",
        content: { title: "Navigation" },
        position: "a0",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const parent = await db
      .insert(repeatableItems)
      .values({
        blockId: navbar.id,
        fieldName: "links",
        content: { label: "Pokemon" },
        position: "a0",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const child = await db
      .insert(repeatableItems)
      .values({
        blockId: navbar.id,
        parentItemId: parent.id,
        fieldName: "children",
        content: { image: { _fileId: file.id } },
        position: "a0",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const input = { projectSlug: project.slug, layoutId: layout.layoutId };
    const readTool = () =>
      runService(
        callTool(ctx, {
          projectId: project.id,
          name: "getLayout",
          arguments: { layoutId: layout.layoutId },
        }),
      );
    await db
      .update(blocks)
      .set({ content: { title: "Edited navigation" } })
      .where(eq(blocks.id, navbar.id));

    // Visitors, members and tools all read the current rows.
    const view = await runService(getLayout(createServiceContext(db, null), input));
    expect(await runService(getLayout(ctx, input))).toEqual(view);
    expect(await readTool()).toEqual({ ok: true, result: view });
    expect(view.layout.beforeBlockIds).toEqual([navbar.id]);
    expect(view.layout.afterBlockIds).toEqual([footer.id]);
    expect(view.blocks).toMatchObject([
      { id: navbar.id, type: "navbar", slot: "before" },
      { id: footer.id, type: "footer", slot: "after", content: { title: "Footer" } },
    ]);
    expect(view.blocks[0].content).toEqual({
      title: "Edited navigation",
      links: [{ _itemId: parent.id }],
    });
    expect(view.repeatableItems.find((item) => item.id === parent.id)?.content).toEqual({
      label: "Pokemon",
      children: [{ _itemId: child.id }],
    });
    expect(view.files.map((file) => file.id)).toEqual([file.id]);
    expect(await db.select().from(pages)).toEqual([]);
  });

  it("scopes layout names in the tool to the selected project and environment", async () => {
    const { db, layout, memberUser, project } = await createProjectFixture("layout-tool-scope");
    const ctx = createServiceContext(db, memberUser);
    // Another project's layout has the same name.
    await createProjectFixture("layout-tool-other");
    const now = Date.now();
    const development = await db
      .insert(environments)
      .values({
        projectId: project.id,
        name: "development",
        type: "development",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const devLayout = await db
      .insert(layouts)
      .values({
        projectId: project.id,
        environmentId: development.id,
        layoutId: "development-only",
        contentUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const read = (layoutId: unknown, environmentName = ctx.environmentName) =>
      runService(
        callTool(
          { ...ctx, environmentName },
          { projectId: project.id, name: "getLayout", arguments: { layoutId } },
        ),
      );
    for (const layoutId of ["missing", devLayout.layoutId]) {
      expect(await read(layoutId)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    }
    expect(await read(layout.layoutId, development.name)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(await read(layout.layoutId, "missing")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(await read(layout.layoutId)).toMatchObject({
      ok: true,
      result: { layout: { layoutId: layout.layoutId } },
    });
    expect(await read(devLayout.layoutId, development.name)).toMatchObject({
      ok: true,
      result: { layout: { layoutId: devLayout.layoutId } },
    });
    for (const layoutId of ["", 1, undefined]) {
      expect(await read(layoutId)).toMatchObject({ ok: false });
    }
  });

  it("returns not found for a missing layout, environment or project", async () => {
    const { db, layout, memberUser, project } = await createProjectFixture("layout-access");
    const input = { projectSlug: project.slug, layoutId: layout.layoutId };
    const ctx = createServiceContext(db, memberUser);
    await expect(
      runService(getLayout(ctx, { ...input, layoutId: "missing" })),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      runService(getLayout({ ...ctx, environmentName: "missing" }, input)),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      runService(getLayout(ctx, { ...input, projectSlug: "missing" })),
    ).rejects.toMatchObject({
      status: 404,
    });
  });
});
