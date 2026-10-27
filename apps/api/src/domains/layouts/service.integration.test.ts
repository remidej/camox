import { generateUuidv7 } from "@camox/api-contract/ids";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import {
  createProjectFixture,
  createServiceContext,
  inScope,
  startDraft,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import {
  blockDefinitions,
  blocks,
  drafts,
  files,
  layouts,
  pages,
  repeatableItems,
} from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { callTool } from "../agent/service";
import { getLayout } from "./service";

describe("standalone shared layout reads", () => {
  it("loads ordered layout blocks, nested items and files without creating a page", async () => {
    const { db, layout, memberUser, project } = await createProjectFixture("layout-view");
    const ctx = createServiceContext(db, memberUser);
    const now = Date.now();
    const title = { type: "string", fieldType: "String" };
    await db.insert(blockDefinitions).values(
      [
        {
          blockId: "navbar",
          properties: {
            title,
            links: {
              type: "array",
              fieldType: "Repeater",
              items: {
                type: "object",
                properties: {
                  label: title,
                  children: {
                    type: "array",
                    fieldType: "Repeater",
                    items: {
                      type: "object",
                      properties: { image: { type: "object", fieldType: "Image" } },
                    },
                  },
                },
              },
            },
          },
        },
        { blockId: "footer", properties: { title } },
      ].map(({ blockId, properties }) => ({
        projectId: project.id,
        blockId,
        title: blockId,
        description: "",
        contentSchema: { type: "object", properties },
        createdAt: now,
        updatedAt: now,
      })),
    );
    const file = await db
      .insert(files)
      .values({
        projectId: project.id,
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
        projectId: project.id,
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
        projectId: project.id,
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
    const input = { projectUuid: project.uuid, layoutId: layout.layoutId };
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
    const view = await runService(getLayout(inScope(createServiceContext(db, null), null), input));
    expect(await runService(getLayout(inScope(ctx, null), input))).toEqual(view);
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

  it("scopes layout names in the tool to the selected project and draft", async () => {
    const { db, layout, memberUser, project } = await createProjectFixture("layout-tool-scope");
    const ctx = createServiceContext(db, memberUser);
    // Another project's layout has the same name.
    await createProjectFixture("layout-tool-other");
    const now = Date.now();
    // Only a draft with code declares this layout, as its previewed revision synced it; Live
    // doesn't.
    const draftId = await startDraft(db, project.id, memberUser.id);
    await db
      .update(drafts)
      .set({ previewedRevisionId: generateUuidv7() })
      .where(eq(drafts.id, draftId));
    const draftLayout = await db
      .insert(layouts)
      .values({
        projectId: project.id,
        draftId,
        layoutId: "draft-only",
        contentUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const read = (layoutId: unknown, draft: ServiceContext["draft"] = null) =>
      runService(
        callTool(
          { ...ctx, draft },
          { projectId: project.id, name: "getLayout", arguments: { layoutId } },
        ),
      );
    const inDraft = { id: draftId, create: false };
    for (const layoutId of ["missing", draftLayout.layoutId]) {
      expect(await read(layoutId)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    }
    expect(await read("missing", inDraft)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(await read(layout.layoutId)).toMatchObject({
      ok: true,
      result: { layout: { layoutId: layout.layoutId } },
    });
    expect(await read(draftLayout.layoutId, inDraft)).toMatchObject({
      ok: true,
      result: { layout: { layoutId: draftLayout.layoutId } },
    });
    for (const layoutId of ["", 1, undefined]) {
      expect(await read(layoutId)).toMatchObject({ ok: false });
    }
  });

  it("returns not found for a missing layout or project", async () => {
    const { db, layout, memberUser, project } = await createProjectFixture("layout-access");
    const input = { projectUuid: project.uuid, layoutId: layout.layoutId };
    const ctx = createServiceContext(db, memberUser);
    await expect(
      runService(getLayout(inScope(ctx, null), { ...input, layoutId: "missing" })),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      runService(getLayout(inScope(ctx, null), { ...input, projectUuid: generateUuidv7() })),
    ).rejects.toMatchObject({
      status: 404,
    });
  });
});
