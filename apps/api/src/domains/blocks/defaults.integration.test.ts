import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import {
  createProjectFixture,
  syncDefinitionSet,
  createServiceContext,
  seedLiveThrough,
  inScope,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, pages } from "../../schema";
import {
  createBlock,
  getBlock,
  getLayoutMarkdown,
  getPageMarkdown,
  updateBlockContent,
} from "./service";

async function fixture(suffix: string) {
  const base = await createProjectFixture(suffix);
  const ctx = createServiceContext(base.db, base.memberUser);
  await syncDefinitionSet(base.db, base.project, {
    blocks: [
      {
        blockId: "hero",
        title: "Hero",
        description: "Reusable hero",
        contentSchema: {
          type: "object",
          properties: {
            title: { fieldType: "String", type: "string", default: "Welcome" },
            cta: { fieldType: "Link", default: { text: "Learn more", href: "/about" } },
            items: {
              fieldType: "Repeater",
              minItems: 1,
              items: { properties: { title: { default: "Item" } } },
            },
          },
          toMarkdown: ["# {{title}}", "{{cta}}"],
        },
        settingsSchema: { properties: { visible: { default: true } } },
      },
    ],
  });
  const now = Date.now();
  const page = await base.db
    .insert(pages)
    .values({
      projectId: base.project.id,
      layoutId: base.layout.layoutId,
      pathSegment: "",
      fullPath: "/",
      nickname: "Home",
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return { ctx, db: base.db, layout: base.layout, page, project: base.project };
}

describe("createBlock defaults", () => {
  it("stores defaults and exposes them in reads and Markdown", async () => {
    const { ctx, page, project } = await fixture("create-defaults");
    const created = await seedLiveThrough(ctx, project.id, (draft) =>
      createBlock(inScope(ctx, draft), { pageId: page.id, type: "hero", content: {} }),
    );
    const result = await runService(getBlock(inScope(ctx, null), { id: created.id }));
    expect(result.block.content).toMatchObject({
      title: "Welcome",
      cta: { text: "Learn more", href: "/about" },
    });
    expect(result.block.settings).toEqual({ visible: true });
    expect(result.repeatableItems).toHaveLength(1);
    expect(result.repeatableItems[0].content).toEqual({ title: "Item" });
    const { markdown } = await runService(getPageMarkdown(inScope(ctx, null), { pageId: page.id }));
    expect(markdown).toContain("# Welcome");
    expect(markdown).toContain("[Learn more](/about)");
  });

  it("reads a layout's current slot Markdown publicly", async () => {
    const { ctx, db, layout, page, project } = await fixture("layout-markdown");
    const created = await seedLiveThrough(ctx, project.id, (draft) =>
      createBlock(inScope(ctx, draft), {
        pageId: page.id,
        type: "hero",
        content: { title: "First" },
      }),
    );
    await db
      .update(blocks)
      .set({ pageId: null, layoutId: layout.layoutId, slot: "before" })
      .where(eq(blocks.id, created.id));
    await seedLiveThrough(ctx, project.id, (draft) =>
      updateBlockContent(inScope(ctx, draft), { id: created.id, content: { title: "Edited" } }),
    );

    const publicCtx = createServiceContext(db, null);
    const markdown = await runService(
      getLayoutMarkdown(inScope(publicCtx, null), {
        projectUuid: project.uuid,
        layoutId: layout.layoutId,
      }),
    );
    expect(markdown.before).toContain("# Edited");
    expect(markdown.before).not.toContain("First");
    expect(markdown.after).toBe("");
    expect(markdown.projectName).toBe(project.name);
  });

  it("preserves supplied content but enforces repeater minimums", async () => {
    const { ctx, page, project } = await fixture("create-explicit");
    await expect(
      seedLiveThrough(ctx, project.id, (draft) =>
        createBlock(inScope(ctx, draft), {
          pageId: page.id,
          type: "hero",
          content: { items: [] },
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const created = await seedLiveThrough(ctx, project.id, (draft) =>
      createBlock(inScope(ctx, draft), {
        pageId: page.id,
        type: "hero",
        content: { title: "", items: [{ title: "Explicit" }] },
        settings: { visible: false },
      }),
    );
    const result = await runService(getBlock(inScope(ctx, null), { id: created.id }));
    expect(result.block.content).toMatchObject({ title: "", cta: { text: "Learn more" } });
    expect(result.block.settings).toEqual({ visible: false });
    expect(result.repeatableItems.map((item) => item.content)).toEqual([{ title: "Explicit" }]);
  });

  it("does not duplicate UI seed bundles and rejects bundles below the minimum", async () => {
    const { ctx, page, project } = await fixture("create-ui-seeds");
    for (const repeatableItems of [
      [],
      [
        {
          tempId: "seed_1",
          parentTempId: null,
          fieldName: "items",
          content: { title: "UI item" },
          position: "a0",
        },
      ],
    ]) {
      if (repeatableItems.length === 0) {
        await expect(
          seedLiveThrough(ctx, project.id, (draft) =>
            createBlock(inScope(ctx, draft), {
              pageId: page.id,
              type: "hero",
              content: {},
              repeatableItems,
            }),
          ),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        continue;
      }
      const created = await seedLiveThrough(ctx, project.id, (draft) =>
        createBlock(inScope(ctx, draft), {
          pageId: page.id,
          type: "hero",
          content: {},
          repeatableItems,
        }),
      );
      const result = await runService(getBlock(inScope(ctx, null), { id: created.id }));
      expect(result.repeatableItems.map((item) => item.content)).toEqual(
        repeatableItems.map((item) => item.content),
      );
    }
  });
});
