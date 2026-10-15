import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import {
  blockDefinitions,
  blocks,
  environments,
  layouts,
  pages,
  repeatableItems,
} from "../../schema";
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
      environmentId: base.environment.id,
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
  return { ...base, ctx, page };
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
    const { db, ctx, page } = await fixture("existing-overrides");
    const block = await runService(
      createBlock(
        ctx,
        {
          pageId: page.id,
          type: "video",
          content: {
            videos: [{ embed: validEmbed }, { embed: validEmbed, clips: [{ embed: validEmbed }] }],
          },
        },
        null,
      ),
    );
    const items = await db
      .select()
      .from(repeatableItems)
      .where(eq(repeatableItems.blockId, block.id))
      .orderBy(repeatableItems.id);
    const [first, second] = items.filter((item) => item.parentItemId === null);
    const clip = items.find((item) => item.parentItemId === second.id)!;
    await expectRejectedWithoutWrites(db, () =>
      runService(
        updateBlockContent(
          ctx,
          {
            id: block.id,
            content: {
              videos: [
                { _itemId: second.id, label: "Changed" },
                { _itemId: first.id, embed: { url: validEmbed } },
              ],
            },
          },
          null,
        ),
      ),
    );
    await expectRejectedWithoutWrites(db, () =>
      runService(
        updateBlockContent(
          ctx,
          {
            id: block.id,
            content: {
              videos: [
                { _itemId: first.id, label: "Changed" },
                { _itemId: second.id, clips: [{ _itemId: clip.id, embed: 42 }] },
              ],
            },
          },
          null,
        ),
      ),
    );
    const changed = "https://video.example/embed/456";
    await runService(
      updateBlockContent(
        ctx,
        {
          id: block.id,
          content: {
            videos: [
              { _itemId: first.id },
              { _itemId: second.id, clips: [{ _itemId: clip.id, embed: changed }] },
            ],
          },
        },
        null,
      ),
    );
    expect(
      (await db.select().from(repeatableItems).where(eq(repeatableItems.id, clip.id)).get())
        ?.content,
    ).toEqual({ embed: changed });
  });

  it("rejects ambiguous explicit seed graphs before creating any rows", async () => {
    const { db, ctx, page } = await fixture("seed-graphs");
    const block = await runService(
      createBlock(ctx, { pageId: page.id, type: "video", content: {} }, null),
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
          createRepeatableItem(
            ctx,
            {
              blockId: block.id,
              fieldName: "videos",
              content: { embed: validEmbed },
              nestedItems: seeds,
            },
            null,
          ),
        ),
      );
      await expectRejectedWithoutWrites(db, () =>
        runService(
          createBlock(
            ctx,
            {
              pageId: page.id,
              type: "video",
              content: {},
              repeatableItems: seeds,
            },
            null,
          ),
        ),
      );
    }
  });

  it.each(invalidEmbeds)("rejects $name on block create and update", async ({ name, value }) => {
    const { db, ctx, page } = await fixture(`block-${name}`);
    await expectRejectedWithoutWrites(db, () =>
      runService(
        createBlock(ctx, { pageId: page.id, type: "video", content: { embed: value } }, null),
      ),
    );
    const block = await runService(
      createBlock(
        ctx,
        {
          pageId: page.id,
          type: "video",
          content: { embed: validEmbed, title: "Original" },
        },
        null,
      ),
    );
    await expectRejectedWithoutWrites(db, () =>
      runService(
        updateBlockContent(
          ctx,
          { id: block.id, content: { title: "Changed", embed: value } },
          null,
        ),
      ),
    );
  });

  it.each(invalidEmbeds)(
    "rejects $name in nested inline arrays before writing any sibling",
    async ({ name, value }) => {
      const { db, ctx, page } = await fixture(`inline-${name}`);
      const content = {
        title: "Changed",
        videos: [
          { embed: validEmbed },
          { embed: validEmbed, clips: [{ embed: validEmbed }, { embed: value }] },
        ],
      };
      await expectRejectedWithoutWrites(db, () =>
        runService(createBlock(ctx, { pageId: page.id, type: "video", content }, null)),
      );
      const block = await runService(
        createBlock(
          ctx,
          {
            pageId: page.id,
            type: "video",
            content: { title: "Original", videos: [{ embed: validEmbed }] },
          },
          null,
        ),
      );
      await expectRejectedWithoutWrites(db, () =>
        runService(updateBlockContent(ctx, { id: block.id, content }, null)),
      );
    },
  );

  it.each(invalidEmbeds)(
    "rejects $name in explicit block seeds before inserting the block or earlier seeds",
    async ({ name, value }) => {
      const { db, ctx, page } = await fixture(`block-seeds-${name}`);
      await expectRejectedWithoutWrites(db, () =>
        runService(
          createBlock(
            ctx,
            {
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
            },
            null,
          ),
        ),
      );
    },
  );

  it.each(invalidEmbeds)(
    "rejects $name on direct repeater create and update at both depths",
    async ({ name, value }) => {
      const { db, ctx, page } = await fixture(`item-${name}`);
      const block = await runService(
        createBlock(
          ctx,
          {
            pageId: page.id,
            type: "video",
            content: {},
          },
          null,
        ),
      );
      const video = await runService(
        createRepeatableItem(
          ctx,
          {
            blockId: block.id,
            fieldName: "videos",
            content: { embed: validEmbed },
          },
          null,
        ),
      );
      for (const location of [
        { fieldName: "videos", parentItemId: null },
        { fieldName: "clips", parentItemId: video.id },
      ]) {
        await expectRejectedWithoutWrites(db, () =>
          runService(
            createRepeatableItem(
              ctx,
              {
                blockId: block.id,
                ...location,
                content: { embed: value },
              },
              null,
            ),
          ),
        );
        const item = await runService(
          createRepeatableItem(
            ctx,
            {
              blockId: block.id,
              ...location,
              content: { embed: validEmbed, label: "Original" },
            },
            null,
          ),
        );
        await expectRejectedWithoutWrites(db, () =>
          runService(
            updateRepeatableItemContent(
              ctx,
              {
                id: item.id,
                content: { label: "Changed", embed: value },
              },
              null,
            ),
          ),
        );
      }
    },
  );

  it.each(invalidEmbeds)(
    "rejects $name in inline arrays on direct repeater writes even when arrays are stripped",
    async ({ name, value }) => {
      const { db, ctx, page } = await fixture(`item-inline-${name}`);
      const block = await runService(
        createBlock(
          ctx,
          {
            pageId: page.id,
            type: "video",
            content: {},
          },
          null,
        ),
      );
      const content = {
        embed: validEmbed,
        clips: [{ embed: validEmbed }, { embed: value }],
      };
      await expectRejectedWithoutWrites(db, () =>
        runService(
          createRepeatableItem(ctx, { blockId: block.id, fieldName: "videos", content }, null),
        ),
      );
      const item = await runService(
        createRepeatableItem(
          ctx,
          {
            blockId: block.id,
            fieldName: "videos",
            content: { embed: validEmbed },
          },
          null,
        ),
      );
      await expectRejectedWithoutWrites(db, () =>
        runService(updateRepeatableItemContent(ctx, { id: item.id, content }, null)),
      );
    },
  );

  it.each(invalidEmbeds)(
    "rejects $name in nested repeater seeds before inserting the parent or earlier siblings",
    async ({ name, value }) => {
      const { db, ctx, page } = await fixture(`item-seeds-${name}`);
      const block = await runService(
        createBlock(
          ctx,
          {
            pageId: page.id,
            type: "video",
            content: {},
          },
          null,
        ),
      );
      await expectRejectedWithoutWrites(db, () =>
        runService(
          createRepeatableItem(
            ctx,
            {
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
            },
            null,
          ),
        ),
      );
    },
  );

  it("uses the owning environment's embed schema despite a different context environment", async () => {
    const { db, ctx, project, page } = await fixture("environment");
    const now = 1_700_000_000_000;
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
    // The production definition was inserted first, and accepts this URL.
    // Selecting that arbitrary row would bypass the development restriction.
    const definition = await db
      .select()
      .from(blockDefinitions)
      .where(eq(blockDefinitions.projectId, project.id))
      .get();
    await db.insert(blockDefinitions).values({
      ...definition!,
      environmentId: development.id,
      contentSchema: {
        properties: {
          videos: {
            fieldType: "Repeater",
            items: {
              properties: {
                embed: { ...embed, pattern: "^https://development\\.example/" },
              },
            },
          },
        },
      },
    });
    const developmentLayout = await db
      .insert(layouts)
      .values({
        projectId: project.id,
        environmentId: development.id,
        layoutId: "default",
        contentUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    await db
      .update(pages)
      .set({ environmentId: development.id, layoutId: developmentLayout.layoutId })
      .where(eq(pages.id, page.id));
    // Context still selects production; writes must use the owning page's schema.
    const block = await runService(
      createBlock(ctx, { pageId: page.id, type: "video", content: {} }, null),
    );
    const item = await runService(
      createRepeatableItem(
        ctx,
        {
          blockId: block.id,
          fieldName: "videos",
          content: { embed: "https://development.example/embed/123" },
        },
        null,
      ),
    );
    await expectRejectedWithoutWrites(db, () =>
      runService(
        createRepeatableItem(
          ctx,
          {
            blockId: block.id,
            fieldName: "videos",
            content: { embed: validEmbed },
          },
          null,
        ),
      ),
    );
    await expectRejectedWithoutWrites(db, () =>
      runService(
        updateRepeatableItemContent(ctx, { id: item.id, content: { embed: validEmbed } }, null),
      ),
    );
    await expectRejectedWithoutWrites(db, () =>
      runService(
        updateBlockContent(
          ctx,
          { id: block.id, content: { videos: [{ embed: validEmbed }] } },
          null,
        ),
      ),
    );
  });

  it("accepts matching strings and strings on embeds without a pattern", async () => {
    const { db, ctx, page } = await fixture("valid");
    const block = await runService(
      createBlock(
        ctx,
        {
          pageId: page.id,
          type: "video",
          content: {
            embed: validEmbed,
            unrestricted: "<iframe></iframe>",
            videos: [{ embed: validEmbed, clips: [{ embed: validEmbed }] }],
          },
        },
        null,
      ),
    );
    expect(block.content).toMatchObject({ embed: validEmbed, unrestricted: "<iframe></iframe>" });
    const changed = "https://video.example/embed/456";
    await runService(
      updateBlockContent(
        ctx,
        { id: block.id, content: { embed: changed, unrestricted: "" } },
        null,
      ),
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
        updateRepeatableItemContent(ctx, { id: item.id, content: { embed: changed } }, null),
      );
      expect(
        (await db.select().from(repeatableItems).where(eq(repeatableItems.id, item.id)).get())
          ?.content,
      ).toEqual({ embed: changed });
    }
  });

  it("does not revalidate historical invalid embeds on unrelated partial updates", async () => {
    const { db, ctx, page } = await fixture("historical");
    const block = await runService(
      createBlock(
        ctx,
        {
          pageId: page.id,
          type: "video",
          content: { videos: [{ embed: validEmbed, clips: [{ embed: validEmbed }] }] },
        },
        null,
      ),
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
      updateBlockContent(ctx, { id: block.id, content: { title: "Updated title" } }, null),
    );
    expect((await db.select().from(blocks).where(eq(blocks.id, block.id)).get())?.content).toEqual({
      embed: 123,
      title: "Updated title",
    });
    for (const item of items) {
      await runService(
        updateRepeatableItemContent(
          ctx,
          { id: item.id, content: { label: "Updated label" } },
          null,
        ),
      );
      expect(
        (await db.select().from(repeatableItems).where(eq(repeatableItems.id, item.id)).get())
          ?.content,
      ).toEqual({ embed: "historical invalid URL", label: "Updated label" });
    }
  });
});
