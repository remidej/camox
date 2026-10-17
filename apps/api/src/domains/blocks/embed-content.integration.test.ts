import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createServiceContext, inScope } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, drafts, layouts, pages, repeatableItems } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { createRepeatableItem, updateRepeatableItemContent } from "../repeatable-items/service";
import { createBlock, updateBlockContent } from "./service";

const validEmbed = "https://video.example/embed/123";
const embed = {
  type: "string",
  fieldType: "Embed",
  pattern: "^https://video\\.example/embed/[0-9]+$",
};
const videoProperties = {
  embed,
  label: { type: "string" },
  clips: {
    type: "array",
    fieldType: "Repeater",
    items: { type: "object", properties: { embed, label: { type: "string" } } },
  },
};
const invalidEmbeds = [
  { name: "null", value: null },
  { name: "number", value: 123 },
  { name: "boolean", value: false },
  { name: "object", value: { url: validEmbed } },
  { name: "array", value: [validEmbed] },
  { name: "pattern mismatch", value: "https://other.example/embed/123" },
];

async function fixture(suffix: string) {
  const base = await createProjectFixture(`embed-${suffix}`);
  const ctx = createServiceContext(base.db, base.memberUser);
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      blockId: "video",
      title: "Video",
      description: "Embed validation fixture",
      contentSchema: {
        type: "object",
        properties: {
          embed,
          unrestricted: { type: "string", fieldType: "Embed" },
          title: { type: "string" },
          videos: {
            type: "array",
            fieldType: "Repeater",
            items: { type: "object", properties: videoProperties },
          },
        },
      },
    }),
  );
  const now = 1_700_000_000_000;
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
  // Content is written in drafts (ADR 0003): these writes only need one.
  const draft = await base.db
    .insert(drafts)
    .values({
      projectId: base.project.id,
      kind: "regular",
      createdBy: base.memberUser.id,
      createdAt: now,
    })
    .returning()
    .get();
  return {
    ...base,
    ctx,
    page,
    draft: { id: draft.id, kind: draft.kind, projectId: draft.projectId },
  };
}

// Include timestamps and parent markers, not just content: rejected writes must
// neither persist earlier siblings nor mark an otherwise unchanged page dirty.
async function snapshot(db: Awaited<ReturnType<typeof fixture>>["db"]) {
  return {
    blocks: await db.select().from(blocks).orderBy(blocks.id),
    items: await db.select().from(repeatableItems).orderBy(repeatableItems.id),
    pages: await db.select().from(pages).orderBy(pages.id),
    layouts: await db.select().from(layouts).orderBy(layouts.layoutId),
  };
}

async function expectRejectedWithoutWrites(
  db: Awaited<ReturnType<typeof fixture>>["db"],
  write: () => Promise<unknown>,
) {
  const before = await snapshot(db);
  await expect(write()).rejects.toMatchObject({
    code: "BAD_REQUEST",
    data: { field: expect.any(String) },
  });
  expect(await snapshot(db)).toEqual(before);
}

describe("embed content validation", () => {
  it("preflights existing item overrides before repositioning or updating earlier items", async () => {
    const { db, ctx, page, draft } = await fixture("existing-overrides");
    const block = await runService(
      createBlock(inScope(ctx, draft), {
        pageId: page.id,
        type: "video",
        content: {
          videos: [{ embed: validEmbed }, { embed: validEmbed, clips: [{ embed: validEmbed }] }],
        },
      }),
    );
    const items = await db
      .select()
      .from(repeatableItems)
      .where(eq(repeatableItems.blockId, block.id))
      .orderBy(repeatableItems.position);
    const [first, second] = items.filter((item) => item.parentItemId === null);
    const clip = items.find((item) => item.parentItemId === second.id)!;
    await expectRejectedWithoutWrites(db, () =>
      runService(
        updateBlockContent(inScope(ctx, draft), {
          id: block.id,
          content: {
            videos: [
              { _itemId: second.id, label: "Changed" },
              { _itemId: first.id, embed: { url: validEmbed } },
            ],
          },
        }),
      ),
    );
    await expectRejectedWithoutWrites(db, () =>
      runService(
        updateBlockContent(inScope(ctx, draft), {
          id: block.id,
          content: {
            videos: [
              { _itemId: first.id, label: "Changed" },
              { _itemId: second.id, clips: [{ _itemId: clip.id, embed: 42 }] },
            ],
          },
        }),
      ),
    );
    const changed = "https://video.example/embed/456";
    await runService(
      updateBlockContent(inScope(ctx, draft), {
        id: block.id,
        content: {
          videos: [
            { _itemId: first.id },
            { _itemId: second.id, clips: [{ _itemId: clip.id, embed: changed }] },
          ],
        },
      }),
    );
    expect(
      (await db.select().from(repeatableItems).where(eq(repeatableItems.id, clip.id)).get())
        ?.content,
    ).toEqual({ embed: changed });
  });

  it("rejects ambiguous explicit seed graphs before creating any rows", async () => {
    const { db, ctx, page, draft } = await fixture("seed-graphs");
    const block = await runService(
      createBlock(inScope(ctx, draft), { pageId: page.id, type: "video", content: {} }),
    );
    const parent = {
      tempId: "parent",
      parentTempId: null,
      fieldName: "clips",
      position: "a0",
      content: { embed: validEmbed },
    };
    const child = { ...parent, tempId: "child", parentTempId: "parent" };
    for (const seeds of [[parent, parent], [child, parent], [{ ...parent, tempId: "" }]]) {
      await expectRejectedWithoutWrites(db, () =>
        runService(
          createRepeatableItem(inScope(ctx, draft), {
            blockId: block.id,
            fieldName: "videos",
            content: { embed: validEmbed },
            nestedItems: seeds,
          }),
        ),
      );
      await expectRejectedWithoutWrites(db, () =>
        runService(
          createBlock(inScope(ctx, draft), {
            pageId: page.id,
            type: "video",
            content: {},
            repeatableItems: seeds,
          }),
        ),
      );
    }
  });

  it.each(invalidEmbeds)("rejects $name on block create and update", async ({ name, value }) => {
    const { db, ctx, page, draft } = await fixture(`block-${name}`);
    await expectRejectedWithoutWrites(db, () =>
      runService(
        createBlock(inScope(ctx, draft), {
          pageId: page.id,
          type: "video",
          content: { embed: value },
        }),
      ),
    );
    const block = await runService(
      createBlock(inScope(ctx, draft), {
        pageId: page.id,
        type: "video",
        content: { embed: validEmbed, title: "Original" },
      }),
    );
    await expectRejectedWithoutWrites(db, () =>
      runService(
        updateBlockContent(inScope(ctx, draft), {
          id: block.id,
          content: { title: "Changed", embed: value },
        }),
      ),
    );
  });

  it.each(invalidEmbeds)(
    "rejects $name in nested inline arrays before writing any sibling",
    async ({ name, value }) => {
      const { db, ctx, page, draft } = await fixture(`inline-${name}`);
      const content = {
        title: "Changed",
        videos: [
          { embed: validEmbed },
          { embed: validEmbed, clips: [{ embed: validEmbed }, { embed: value }] },
        ],
      };
      await expectRejectedWithoutWrites(db, () =>
        runService(createBlock(inScope(ctx, draft), { pageId: page.id, type: "video", content })),
      );
      const block = await runService(
        createBlock(inScope(ctx, draft), {
          pageId: page.id,
          type: "video",
          content: { title: "Original", videos: [{ embed: validEmbed }] },
        }),
      );
      await expectRejectedWithoutWrites(db, () =>
        runService(updateBlockContent(inScope(ctx, draft), { id: block.id, content })),
      );
    },
  );

  it.each(invalidEmbeds)(
    "rejects $name in explicit block seeds before inserting the block or earlier seeds",
    async ({ name, value }) => {
      const { db, ctx, page, draft } = await fixture(`block-seeds-${name}`);
      await expectRejectedWithoutWrites(db, () =>
        runService(
          createBlock(inScope(ctx, draft), {
            pageId: page.id,
            type: "video",
            content: { embed: validEmbed },
            repeatableItems: [
              {
                tempId: "video",
                parentTempId: null,
                fieldName: "videos",
                position: "a0",
                content: { embed: validEmbed },
              },
              {
                tempId: "first-clip",
                parentTempId: "video",
                fieldName: "clips",
                position: "a0",
                content: { embed: validEmbed },
              },
              {
                tempId: "invalid-clip",
                parentTempId: "video",
                fieldName: "clips",
                position: "a1",
                content: { embed: value },
              },
            ],
          }),
        ),
      );
    },
  );

  it.each(invalidEmbeds)(
    "rejects $name on direct repeater create and update at both depths",
    async ({ name, value }) => {
      const { db, ctx, page, draft } = await fixture(`item-${name}`);
      const block = await runService(
        createBlock(inScope(ctx, draft), {
          pageId: page.id,
          type: "video",
          content: {},
        }),
      );
      const video = await runService(
        createRepeatableItem(inScope(ctx, draft), {
          blockId: block.id,
          fieldName: "videos",
          content: { embed: validEmbed },
        }),
      );
      for (const location of [
        { fieldName: "videos", parentItemId: null },
        { fieldName: "clips", parentItemId: video.id },
      ]) {
        await expectRejectedWithoutWrites(db, () =>
          runService(
            createRepeatableItem(inScope(ctx, draft), {
              blockId: block.id,
              ...location,
              content: { embed: value },
            }),
          ),
        );
        const item = await runService(
          createRepeatableItem(inScope(ctx, draft), {
            blockId: block.id,
            ...location,
            content: { embed: validEmbed, label: "Original" },
          }),
        );
        await expectRejectedWithoutWrites(db, () =>
          runService(
            updateRepeatableItemContent(inScope(ctx, draft), {
              id: item.id,
              content: { label: "Changed", embed: value },
            }),
          ),
        );
      }
    },
  );

  it.each(invalidEmbeds)(
    "rejects $name in inline arrays on direct repeater writes even when arrays are stripped",
    async ({ name, value }) => {
      const { db, ctx, page, draft } = await fixture(`item-inline-${name}`);
      const block = await runService(
        createBlock(inScope(ctx, draft), {
          pageId: page.id,
          type: "video",
          content: {},
        }),
      );
      const content = {
        embed: validEmbed,
        clips: [{ embed: validEmbed }, { embed: value }],
      };
      await expectRejectedWithoutWrites(db, () =>
        runService(
          createRepeatableItem(inScope(ctx, draft), {
            blockId: block.id,
            fieldName: "videos",
            content,
          }),
        ),
      );
      const item = await runService(
        createRepeatableItem(inScope(ctx, draft), {
          blockId: block.id,
          fieldName: "videos",
          content: { embed: validEmbed },
        }),
      );
      await expectRejectedWithoutWrites(db, () =>
        runService(updateRepeatableItemContent(inScope(ctx, draft), { id: item.id, content })),
      );
    },
  );

  it.each(invalidEmbeds)(
    "rejects $name in nested repeater seeds before inserting the parent or earlier siblings",
    async ({ name, value }) => {
      const { db, ctx, page, draft } = await fixture(`item-seeds-${name}`);
      const block = await runService(
        createBlock(inScope(ctx, draft), {
          pageId: page.id,
          type: "video",
          content: {},
        }),
      );
      await expectRejectedWithoutWrites(db, () =>
        runService(
          createRepeatableItem(inScope(ctx, draft), {
            blockId: block.id,
            fieldName: "videos",
            content: { embed: validEmbed },
            nestedItems: [
              {
                tempId: "first",
                parentTempId: null,
                fieldName: "clips",
                position: "a0",
                content: { embed: validEmbed },
              },
              {
                tempId: "invalid",
                parentTempId: null,
                fieldName: "clips",
                position: "a1",
                content: { embed: value },
              },
            ],
          }),
        ),
      );
    },
  );

  it("accepts matching strings and strings on embeds without a pattern", async () => {
    const { db, ctx, page, draft } = await fixture("valid");
    const block = await runService(
      createBlock(inScope(ctx, draft), {
        pageId: page.id,
        type: "video",
        content: {
          embed: validEmbed,
          unrestricted: "<iframe></iframe>",
          videos: [{ embed: validEmbed, clips: [{ embed: validEmbed }] }],
        },
      }),
    );
    expect(block.content).toMatchObject({ embed: validEmbed, unrestricted: "<iframe></iframe>" });
    const changed = "https://video.example/embed/456";
    await runService(
      updateBlockContent(inScope(ctx, draft), {
        id: block.id,
        content: { embed: changed, unrestricted: "" },
      }),
    );
    expect((await db.select().from(blocks).where(eq(blocks.id, block.id)).get())?.content).toEqual({
      embed: changed,
      unrestricted: "",
    });
    const items = await db
      .select()
      .from(repeatableItems)
      .where(eq(repeatableItems.blockId, block.id));
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.content).toEqual({ embed: validEmbed });
      await runService(
        updateRepeatableItemContent(inScope(ctx, draft), {
          id: item.id,
          content: { embed: changed },
        }),
      );
      expect(
        (await db.select().from(repeatableItems).where(eq(repeatableItems.id, item.id)).get())
          ?.content,
      ).toEqual({ embed: changed });
    }
  });

  it("does not revalidate historical invalid embeds on unrelated partial updates", async () => {
    const { db, ctx, page, draft } = await fixture("historical");
    const block = await runService(
      createBlock(inScope(ctx, draft), {
        pageId: page.id,
        type: "video",
        content: { videos: [{ embed: validEmbed, clips: [{ embed: validEmbed }] }] },
      }),
    );
    // Simulate rows persisted before embed validation was introduced.
    await db
      .update(blocks)
      .set({ content: { embed: 123 } })
      .where(eq(blocks.id, block.id));
    const items = await db
      .select()
      .from(repeatableItems)
      .where(eq(repeatableItems.blockId, block.id));
    for (const item of items) {
      await db
        .update(repeatableItems)
        .set({ content: { embed: "historical invalid URL" } })
        .where(eq(repeatableItems.id, item.id));
    }
    await runService(
      updateBlockContent(inScope(ctx, draft), {
        id: block.id,
        content: { title: "Updated title" },
      }),
    );
    expect((await db.select().from(blocks).where(eq(blocks.id, block.id)).get())?.content).toEqual({
      embed: 123,
      title: "Updated title",
    });
    for (const item of items) {
      await runService(
        updateRepeatableItemContent(inScope(ctx, draft), {
          id: item.id,
          content: { label: "Updated label" },
        }),
      );
      expect(
        (await db.select().from(repeatableItems).where(eq(repeatableItems.id, item.id)).get())
          ?.content,
      ).toEqual({ embed: "historical invalid URL", label: "Updated label" });
    }
  });
});
