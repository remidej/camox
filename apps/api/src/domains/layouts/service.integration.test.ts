import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, environments, files, layouts, pages, repeatableItems } from "../../schema";
import { callTool } from "../agent/service";
import { getLayout, publishLayout, unpublishLayout } from "./service";

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
        layoutId: layout.id,
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
        layoutId: layout.id,
        type: "navbar",
        slot: "before",
        content: { title: "Published navigation" },
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
    const publicCtx = createServiceContext(db, null);
    const readTool = (source?: "draft" | "live") =>
      runService(
        callTool(ctx, {
          projectId: project.id,
          name: "getLayout",
          arguments: { id: layout.id, ...(source ? { source } : {}) },
        }),
      );
    expect((await runService(getLayout(publicCtx, input))).blocks).toEqual([]);
    expect(await readTool("live")).toMatchObject({
      ok: true,
      result: {
        layout: { id: layout.id, beforeBlockIds: [], afterBlockIds: [] },
        blocks: [],
        repeatableItems: [],
        files: [],
      },
    });
    await runService(publishLayout(ctx, { id: layout.id }));
    await db
      .update(blocks)
      .set({ content: { title: "Draft navigation" } })
      .where(eq(blocks.id, navbar.id));

    const live = await runService(getLayout(publicCtx, input));
    const draft = await runService(getLayout(ctx, { ...input, source: "draft" }));
    expect(await readTool()).toEqual({ ok: true, result: draft });
    expect(await readTool("draft")).toEqual({ ok: true, result: draft });
    expect(await readTool("live")).toEqual({ ok: true, result: live });
    expect(draft.blocks).toMatchObject([
      {
        id: navbar.id,
        type: "navbar",
        slot: "before",
        content: { title: "Draft navigation" },
      },
      { id: footer.id, type: "footer", slot: "after", content: { title: "Footer" } },
    ]);
    expect(live.layout.beforeBlockIds).toEqual([navbar.id]);
    expect(live.layout.afterBlockIds).toEqual([footer.id]);
    expect(live.blocks.map((block) => block.id)).toEqual([navbar.id, footer.id]);
    expect(live.blocks[0].content).toEqual({
      title: "Published navigation",
      links: [{ _itemId: parent.id }],
    });
    expect(draft.blocks[0].content).toMatchObject({ title: "Draft navigation" });
    expect(live.repeatableItems.find((item) => item.id === parent.id)?.content).toEqual({
      label: "Pokemon",
      children: [{ _itemId: child.id }],
    });
    expect(live.files.map((file) => file.id)).toEqual([file.id]);
    expect(await db.select().from(pages)).toEqual([]);

    await runService(unpublishLayout(ctx, { id: layout.id }));
    expect((await runService(getLayout(publicCtx, input))).blocks).toEqual([]);
    expect(await readTool("live")).toMatchObject({ ok: true, result: { blocks: [] } });
    expect((await runService(getLayout(ctx, { ...input, source: "draft" }))).blocks).toHaveLength(
      2,
    );
  });

  it("scopes numeric tool IDs to the selected project and environment for both sources", async () => {
    const { db, layout, memberUser, project } = await createProjectFixture("layout-tool-scope");
    const ctx = createServiceContext(db, memberUser);
    const other = await createProjectFixture("layout-tool-other");
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
        layoutId: layout.layoutId,
        contentUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const read = (id: unknown, source: string, environmentName = ctx.environmentName) =>
      runService(
        callTool(
          { ...ctx, environmentName },
          { projectId: project.id, name: "getLayout", arguments: { id, source } },
        ),
      );
    for (const source of ["draft", "live"]) {
      for (const id of [999999, other.layout.id, devLayout.id]) {
        expect(await read(id, source)).toMatchObject({
          ok: false,
          error: { code: "NOT_FOUND" },
        });
      }
      expect(await read(layout.id, source, development.name)).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
      expect(await read(layout.id, source, "missing")).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
      expect(await read(devLayout.id, source, development.name)).toMatchObject({
        ok: true,
        result: { layout: { id: devLayout.id } },
      });
    }
    for (const id of [0, -1, 1.5, String(layout.id), undefined]) {
      expect(await read(id, "draft")).toMatchObject({ ok: false });
    }
    expect(await read(layout.id, "invalid")).toMatchObject({ ok: false });
  });

  it("protects drafts and scopes file identities to their project and environment", async () => {
    const { db, layout, memberUser, outsiderUser, project } =
      await createProjectFixture("layout-access");
    const input = {
      projectSlug: project.slug,
      layoutId: layout.layoutId,
      source: "draft" as const,
    };
    await expect(
      runService(getLayout(createServiceContext(db, null), input)),
    ).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      runService(getLayout(createServiceContext(db, outsiderUser), input)),
    ).rejects.toMatchObject({
      status: 403,
    });
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
