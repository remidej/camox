import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import {
  createProjectFixture,
  createServiceContext,
  syncDefinitionSet,
  type TestDefinitionSet,
} from "../../../test/fixtures";
import { blockDefinitions, blocks, layouts, pages, repeatableItems } from "../../schema";
import { blocksOfLayout } from "../layouts/identity";

const card = {
  blockId: "card",
  title: "Card",
  description: "",
  contentSchema: {
    type: "object",
    properties: {
      title: { type: "string", default: "Default title" },
      count: { type: "integer", minimum: 0 },
      cards: {
        type: "array",
        fieldType: "Repeater",
        items: {
          type: "object",
          properties: { count: { type: "integer", minimum: 0 } },
        },
      },
    },
  },
  settingsSchema: {
    type: "object",
    properties: { theme: { type: "string", enum: ["light", "dark"], default: "light" } },
  },
};

async function fixture(suffix: string) {
  const base = await createProjectFixture(`bootstrap-validation-${suffix}`);
  const ctx = createServiceContext(base.db, base.memberUser);
  /** Releases the website's Definition Set, holding the card, with `set`'s other parts. */
  const release = (set: TestDefinitionSet = {}) =>
    syncDefinitionSet(base.db, base.project, { blocks: [card], ...set });
  await release();
  return { ...base, ctx, release };
}

async function snapshot(db: Awaited<ReturnType<typeof fixture>>["db"]) {
  return {
    layouts: await db.select().from(layouts).orderBy(layouts.layoutId),
    pages: await db.select().from(pages).orderBy(pages.id),
    blocks: await db.select().from(blocks).orderBy(blocks.id),
    items: await db.select().from(repeatableItems).orderBy(repeatableItems.id),
    definitions: await db
      .select()
      .from(blockDefinitions)
      .orderBy(blockDefinitions.projectId, blockDefinitions.blockId),
  };
}

describe("bootstrap schema validation", () => {
  it("validates a release's layouts against the definitions it releases, not Live's", async () => {
    const { db, release } = await fixture("released-definitions");
    const before = await snapshot(db);
    // Live's card accepts any count from 0; the released code now asks for 10 or more.
    const released = {
      ...card,
      contentSchema: { type: "object", properties: { count: { type: "integer", minimum: 10 } } },
    };
    await expect(
      release({
        blocks: [released],
        layouts: [
          {
            layoutId: "default",
            description: "",
            blocks: [{ type: "card", content: { count: 1 } }],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await snapshot(db)).toEqual(before);
  });

  it("preflights all layouts before metadata updates, inserts or deletions", async () => {
    const { db, release, layout } = await fixture("layouts");
    const before = await snapshot(db);
    await expect(
      release({
        layouts: [
          { layoutId: layout.layoutId, description: "Changed", blocks: [] },
          {
            layoutId: "new",
            description: "",
            blocks: [
              { type: "card", content: { count: 1 } },
              { type: "card", content: { count: -1 } },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await snapshot(db)).toEqual(before);
  });

  it("rejects invalid settings before creating the homepage or earlier blocks", async () => {
    const { db, release, layout } = await fixture("settings");
    const before = await snapshot(db);
    await expect(
      release({
        homepage: {
          layoutId: layout.layoutId,
          blocks: [
            { type: "card", content: { count: 1 } },
            { type: "card", content: {}, settings: { theme: "invalid" } },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await snapshot(db)).toEqual(before);
  });

  it("rejects invalid explicit repeatable seeds before creating the homepage", async () => {
    const { db, release, layout } = await fixture("seeds");
    const before = await snapshot(db);
    await expect(
      release({
        homepage: {
          layoutId: layout.layoutId,
          blocks: [
            {
              type: "card",
              content: {},
              repeatableItems: [
                {
                  tempId: "card",
                  parentTempId: null,
                  fieldName: "cards",
                  content: { count: -1 },
                  position: "a0",
                },
              ],
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await snapshot(db)).toEqual(before);
  });

  it("persists defaults and normalized inline repeaters for layout blocks", async () => {
    const { db, release, layout } = await fixture("defaults");
    await release({
      layouts: [
        {
          layoutId: layout.layoutId,
          description: "",
          blocks: [{ type: "card", content: { cards: [{ count: 2 }] }, settings: {} }],
        },
      ],
    });
    const block = await db.select().from(blocks).where(blocksOfLayout(layout)).get();
    expect(block?.content).toMatchObject({ title: "Default title" });
    expect(block?.settings).toEqual({ theme: "light" });
    const items = await db
      .select()
      .from(repeatableItems)
      .where(eq(repeatableItems.blockId, block!.id));
    expect(items).toHaveLength(1);
    expect(items[0].content).toEqual({ count: 2 });
  });
});
