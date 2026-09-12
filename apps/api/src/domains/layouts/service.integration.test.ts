import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { blocks, files, pages, repeatableItems } from "../../schema";
import { getLayout, publishLayout, unpublishLayout } from "./service";

describe("standalone shared layout reads", () => {
  it("loads ordered shared blocks, nested items and files without creating a page", async () => {
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
        placement: "after",
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
        placement: "before",
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
    expect((await getLayout(publicCtx, input)).blocks).toEqual([]);
    await publishLayout(ctx, { id: layout.id });
    await db
      .update(blocks)
      .set({ content: { title: "Draft navigation" } })
      .where(eq(blocks.id, navbar.id));

    const live = await getLayout(publicCtx, input);
    const draft = await getLayout(ctx, { ...input, source: "draft" });
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

    await unpublishLayout(ctx, { id: layout.id });
    expect((await getLayout(publicCtx, input)).blocks).toEqual([]);
    expect((await getLayout(ctx, { ...input, source: "draft" })).blocks).toHaveLength(2);
  });

  it("protects drafts and scopes file identities to their project and environment", async () => {
    const { db, layout, memberUser, outsiderUser, project } =
      await createProjectFixture("layout-access");
    const input = {
      projectSlug: project.slug,
      layoutId: layout.layoutId,
      source: "draft" as const,
    };
    await expect(getLayout(createServiceContext(db, null), input)).rejects.toMatchObject({
      status: 401,
    });
    await expect(getLayout(createServiceContext(db, outsiderUser), input)).rejects.toMatchObject({
      status: 403,
    });
    const ctx = createServiceContext(db, memberUser);
    await expect(getLayout(ctx, { ...input, layoutId: "missing" })).rejects.toMatchObject({
      status: 404,
    });
    await expect(getLayout({ ...ctx, environmentName: "missing" }, input)).rejects.toMatchObject({
      status: 404,
    });
    await expect(getLayout(ctx, { ...input, projectSlug: "missing" })).rejects.toMatchObject({
      status: 404,
    });
  });
});
