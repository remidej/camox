import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { pages } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { createBlock, getBlock, getPageMarkdown } from "./service";

async function fixture(suffix: string) {
  const base = await createProjectFixture(suffix);
  const ctx = createServiceContext(base.db, base.memberUser);
  await upsertBlockDefinition(createServiceContext(base.db, null), {
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
  });
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
  return { ctx, page };
}

describe("createBlock defaults", () => {
  it("stores defaults and exposes them in reads and Markdown", async () => {
    const { ctx, page } = await fixture("create-defaults");
    const created = await createBlock(ctx, { pageId: page.id, type: "hero", content: {} });
    const result = await getBlock(ctx, { id: created.id, source: "draft" });
    expect(result.block.content).toMatchObject({
      title: "Welcome",
      cta: { text: "Learn more", href: "/about" },
    });
    expect(result.block.settings).toEqual({ visible: true });
    expect(result.repeatableItems).toHaveLength(1);
    expect(result.repeatableItems[0].content).toEqual({ title: "Item" });
    const { markdown } = await getPageMarkdown(ctx, { pageId: page.id });
    expect(markdown).toContain("# Welcome");
    expect(markdown).toContain("[Learn more](/about)");
  });

  it("preserves supplied content and explicit empty repeaters", async () => {
    const { ctx, page } = await fixture("create-explicit");
    const created = await createBlock(ctx, {
      pageId: page.id,
      type: "hero",
      content: { title: "", items: [] },
      settings: { visible: false },
    });
    const result = await getBlock(ctx, { id: created.id, source: "draft" });
    expect(result.block.content).toMatchObject({ title: "", cta: { text: "Learn more" } });
    expect(result.block.settings).toEqual({ visible: false });
    expect(result.repeatableItems).toEqual([]);
  });

  it("does not duplicate UI seed bundles, including empty bundles", async () => {
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
      const created = await createBlock(ctx, {
        pageId: page.id,
        type: "hero",
        content: {},
        repeatableItems,
      });
      const result = await getBlock(ctx, { id: created.id, source: "draft" });
      expect(result.repeatableItems.map((item) => item.content)).toEqual(
        repeatableItems.map((item) => item.content),
      );
    }
  });
});
