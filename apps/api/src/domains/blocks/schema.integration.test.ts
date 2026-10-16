import { generateUuidv7 } from "@camox/api-contract/ids";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, pages, repeatableItems } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { createBlock, editBlock, updateBlockContent, updateBlockSettings } from "./service";

async function fixture(suffix: string) {
  const base = await createProjectFixture(`schema-blocks-${suffix}`);
  const ctx = createServiceContext(base.db, base.memberUser);
  const title = {
    type: "string",
    fieldType: "String",
    minLength: 1,
    maxLength: 12,
    default: "Default",
  };
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      blockId: "schema",
      title: "Schema",
      description: "",
      contentSchema: {
        type: "object",
        $defs: { text: { type: "string" } },
        additionalProperties: false,
        required: ["title", "items", "image"],
        properties: {
          title,
          count: { type: "integer", minimum: 0, maximum: 10 },
          link: { type: "object", properties: { href: { type: "string" } }, required: ["href"] },
          image: { fieldType: "Image", type: "object", properties: { url: { type: "string" } } },
          gallery: {
            fieldType: "ImageList",
            type: "array",
            maxItems: 2,
            items: { fieldType: "Image", type: "object" },
          },
          items: {
            fieldType: "Repeater",
            type: "array",
            minItems: 1,
            maxItems: 2,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title"],
              properties: { title, note: { $ref: "#/$defs/text" } },
            },
            itemSettingsSchema: {
              type: "object",
              properties: { visible: { type: "boolean", default: true } },
              required: ["visible"],
            },
          },
        },
      },
      settingsSchema: {
        type: "object",
        additionalProperties: false,
        required: ["visible", "align"],
        properties: {
          visible: { type: "boolean", default: true },
          align: { type: "string", enum: ["left", "right"], default: "left" },
        },
      },
    }),
  );
  const page = await base.db
    .insert(pages)
    .values({
      projectId: base.project.id,
      layoutId: base.layout.layoutId,
      pathSegment: "",
      fullPath: "/",
      nickname: "Home",
      contentUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .returning()
    .get();
  return { ...base, ctx, page };
}

async function snapshot(db: Awaited<ReturnType<typeof fixture>>["db"]) {
  return {
    blocks: await db.select().from(blocks),
    items: await db.select().from(repeatableItems),
    pages: await db.select().from(pages),
  };
}

describe("block JSON Schema writes", () => {
  it("fills defaults, validates ordinary schemas, and canonicalizes asset lists", async () => {
    const { db, ctx, page } = await fixture("defaults");
    const block = await runService(
      createBlock(
        ctx,
        {
          pageId: page.id,
          type: "schema",
          content: {
            gallery: [{ _fileId: "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b", url: "invented" }],
          },
        },
        null,
      ),
    );
    expect(block.content).toEqual({
      title: "Default",
      gallery: [{ _fileId: "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b" }],
    });
    expect(block.settings).toEqual({ visible: true, align: "left" });
    const items = await db
      .select()
      .from(repeatableItems)
      .where(eq(repeatableItems.blockId, block.id));
    expect(items[0].content).toEqual({ title: "Default" });
    expect(items[0].settings).toEqual({ visible: true });
    await runService(
      updateBlockContent(ctx, { id: block.id, content: { title: "Changed" } }, null),
    );
    await runService(
      updateBlockSettings(ctx, { id: block.id, settings: { align: "right" } }, null),
    );
    for (const content of [
      null,
      [],
      "text",
      { title: 1 },
      { title: "" },
      { count: 1.5 },
      { count: 11 },
      { link: {} },
      { unknown: true },
      { items: [] },
      { items: [{}, {}, {}] },
    ]) {
      const before = await snapshot(db);
      await expect(
        runService(updateBlockContent(ctx, { id: block.id, content }, null)),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        data: { field: expect.any(String) },
      });
      expect(await snapshot(db)).toEqual(before);
    }
  });

  it("preflights settings and explicit seed settings before any content writes", async () => {
    const { db, ctx, page } = await fixture("settings");
    const beforeCreate = await snapshot(db);
    await expect(
      runService(
        createBlock(
          ctx,
          {
            pageId: page.id,
            type: "schema",
            content: {},
            repeatableItems: [
              {
                tempId: "one",
                parentTempId: null,
                fieldName: "items",
                position: "a0",
                content: {},
                settings: { visible: "yes" },
              },
            ],
          },
          null,
        ),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await snapshot(db)).toEqual(beforeCreate);
    const block = await runService(
      createBlock(ctx, { pageId: page.id, type: "schema", content: {} }, null),
    );
    const beforeEdit = await snapshot(db);
    await expect(
      runService(
        editBlock(
          ctx,
          {
            id: block.id,
            content: { title: "Changed" },
            settings: { align: "center" },
          },
          null,
        ),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await snapshot(db)).toEqual(beforeEdit);
  });

  it("plans reference edits before mutation and does not revalidate omitted historical fields", async () => {
    const { db, ctx, page } = await fixture("references");
    const block = await runService(
      createBlock(ctx, { pageId: page.id, type: "schema", content: {} }, null),
    );
    const item = (await db
      .select()
      .from(repeatableItems)
      .where(eq(repeatableItems.blockId, block.id))
      .get())!;
    for (const second of [{ _itemId: generateUuidv7() }, { _itemId: item.id }, { title: 42 }]) {
      const before = await snapshot(db);
      await expect(
        runService(
          updateBlockContent(
            ctx,
            {
              id: block.id,
              content: { items: [{ _itemId: item.id, title: "Changed" }, second] },
            },
            null,
          ),
        ),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await snapshot(db)).toEqual(before);
    }
    await db
      .update(blocks)
      .set({ content: { title: 42 }, settings: { visible: "legacy", align: "left" } })
      .where(eq(blocks.id, block.id));
    await db
      .update(repeatableItems)
      .set({ content: { title: 42 } })
      .where(eq(repeatableItems.id, item.id));
    await runService(
      updateBlockContent(
        ctx,
        {
          id: block.id,
          content: { count: 3, items: [{ _itemId: item.id }] },
        },
        null,
      ),
    );
    await runService(
      updateBlockSettings(ctx, { id: block.id, settings: { align: "right" } }, null),
    );
    expect((await db.select().from(blocks).where(eq(blocks.id, block.id)).get())?.content).toEqual({
      title: 42,
      count: 3,
    });
  });
});
