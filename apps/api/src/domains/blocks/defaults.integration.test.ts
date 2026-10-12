import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, pages } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { publishLayout } from "../layouts/service";
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
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
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
    }),
  );
  const now = Date.now();
  const page = await base.db
    .insert(pages)
    .values({
      projectId: base.project.id,
      environmentId: base.environment.id,
      layoutId: base.layout.id,
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
    const { ctx, page } = await fixture("create-defaults");
    const created = await runService(
      createBlock(ctx, { pageId: page.id, type: "hero", content: {} }),
    );
    const result = await runService(getBlock(ctx, { id: created.id, source: "draft" }));
    expect(result.block.content).toMatchObject({
      title: "Welcome",
      cta: { text: "Learn more", href: "/about" },
    });
    expect(result.block.settings).toEqual({ visible: true });
    expect(result.repeatableItems).toHaveLength(1);
    expect(result.repeatableItems[0].content).toEqual({ title: "Item" });
    const { markdown } = await runService(getPageMarkdown(ctx, { pageId: page.id }));
    expect(markdown).toContain("# Welcome");
    expect(markdown).toContain("[Learn more](/about)");
  });

  it("keeps draft Markdown private", async () => {
    const { ctx, db, page } = await fixture("draft-markdown-private");
    await runService(createBlock(ctx, { pageId: page.id, type: "hero", content: {} }));
    const publicCtx = createServiceContext(db, null);
    await expect(runService(getPageMarkdown(publicCtx, { pageId: page.id }))).rejects.toThrow();
    await expect(
      runService(getPageMarkdown(publicCtx, { pageId: page.id, source: "draft" })),
    ).rejects.toThrow();
  });

  it("reads a layout's live slot Markdown publicly, never its draft", async () => {
    const { ctx, db, layout, page, project } = await fixture("layout-markdown");
    const created = await runService(
      createBlock(ctx, { pageId: page.id, type: "hero", content: { title: "Published" } }),
    );
    await db
      .update(blocks)
      .set({ pageId: null, layoutId: layout.id, slot: "before" })
      .where(eq(blocks.id, created.id));
    await runService(publishLayout(ctx, { id: layout.id }));
    await runService(updateBlockContent(ctx, { id: created.id, content: { title: "Draft" } }));

    const publicCtx = createServiceContext(db, null);
    const markdown = await runService(
      getLayoutMarkdown(publicCtx, { projectSlug: project.slug, layoutId: layout.layoutId }),
    );
    expect(markdown.before).toContain("# Published");
    expect(markdown.before).not.toContain("Draft");
    expect(markdown.after).toBe("");
  });

  it("preserves supplied content but enforces repeater minimums", async () => {
    const { ctx, page } = await fixture("create-explicit");
    await expect(
      runService(
        createBlock(ctx, {
          pageId: page.id,
          type: "hero",
          content: { items: [] },
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const created = await runService(
      createBlock(ctx, {
        pageId: page.id,
        type: "hero",
        content: { title: "", items: [{ title: "Explicit" }] },
        settings: { visible: false },
      }),
    );
    const result = await runService(getBlock(ctx, { id: created.id, source: "draft" }));
    expect(result.block.content).toMatchObject({ title: "", cta: { text: "Learn more" } });
    expect(result.block.settings).toEqual({ visible: false });
    expect(result.repeatableItems.map((item) => item.content)).toEqual([{ title: "Explicit" }]);
  });

  it("does not duplicate UI seed bundles and rejects bundles below the minimum", async () => {
    const { ctx, page } = await fixture("create-ui-seeds");
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
          runService(
            createBlock(ctx, {
              pageId: page.id,
              type: "hero",
              content: {},
              repeatableItems,
            }),
          ),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        continue;
      }
      const created = await runService(
        createBlock(ctx, {
          pageId: page.id,
          type: "hero",
          content: {},
          repeatableItems,
        }),
      );
      const result = await runService(getBlock(ctx, { id: created.id, source: "draft" }));
      expect(result.repeatableItems.map((item) => item.content)).toEqual(
        repeatableItems.map((item) => item.content),
      );
    }
  });
});
