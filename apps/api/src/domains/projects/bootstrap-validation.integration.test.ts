import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import {
  blockDefinitions,
  blocks,
  environments,
  layouts,
  pages,
  repeatableItems,
} from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { syncLayouts } from "../layouts/service";
import { initializeProjectContent } from "./service";

async function fixture(suffix: string) {
  const base = await createProjectFixture(`bootstrap-validation-${suffix}`);
  const ctx = createServiceContext(base.db, base.memberUser);
  await upsertBlockDefinition(ctx, {
    projectSlug: base.project.slug,
    deployToken: base.project.deployToken,
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
  });
  return { ...base, ctx };
}

async function snapshot(db: Awaited<ReturnType<typeof fixture>>["db"]) {
  return {
    layouts: await db.select().from(layouts).orderBy(layouts.id),
    pages: await db.select().from(pages).orderBy(pages.id),
    blocks: await db.select().from(blocks).orderBy(blocks.id),
    items: await db.select().from(repeatableItems).orderBy(repeatableItems.id),
    definitions: await db.select().from(blockDefinitions).orderBy(blockDefinitions.id),
  };
}

describe("bootstrap schema validation", () => {
  it("uses the selected environment's definition rather than another environment's schema", async () => {
    const { db, ctx, project } = await fixture("environment");
    const now = Date.now();
    const development = await db
      .insert(environments)
      .values({
        projectId: project.id,
        name: `dev:${ctx.user!.email}`,
        type: "development",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const definition = await db
      .select()
      .from(blockDefinitions)
      .where(eq(blockDefinitions.projectId, project.id))
      .get();
    await db.insert(blockDefinitions).values({
      ...definition!,
      id: undefined,
      environmentId: development.id,
      contentSchema: {
        type: "object",
        properties: { count: { type: "integer", minimum: 10 } },
      },
    });
    const before = await snapshot(db);
    await expect(
      syncLayouts(
        { ...ctx, environmentName: `dev:${ctx.user!.email}` },
        {
          projectSlug: project.slug,
          autoCreate: false,
          layouts: [
            {
              layoutId: "default",
              description: "",
              blocks: [{ type: "card", content: { count: 1 } }],
            },
          ],
        },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await snapshot(db)).toEqual(before);
  });

  it("preflights all layouts before metadata updates, inserts or deletions", async () => {
    const { db, ctx, project, layout } = await fixture("layouts");
    const before = await snapshot(db);
    await expect(
      syncLayouts(ctx, {
        projectSlug: project.slug,
        deployToken: project.deployToken,
        autoCreate: false,
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
    const { db, ctx, project, layout } = await fixture("settings");
    const before = await snapshot(db);
    await expect(
      initializeProjectContent(ctx, {
        projectSlug: project.slug,
        deployToken: project.deployToken,
        layoutId: layout.layoutId,
        blocks: [
          { type: "card", content: { count: 1 } },
          { type: "card", content: {}, settings: { theme: "invalid" } },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await snapshot(db)).toEqual(before);
  });

  it("rejects invalid explicit repeatable seeds before creating the homepage", async () => {
    const { db, ctx, project, layout } = await fixture("seeds");
    const before = await snapshot(db);
    await expect(
      initializeProjectContent(ctx, {
        projectSlug: project.slug,
        deployToken: project.deployToken,
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
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await snapshot(db)).toEqual(before);
  });

  it("persists defaults and normalized inline repeaters for layout blocks", async () => {
    const { db, ctx, project, layout } = await fixture("defaults");
    await syncLayouts(ctx, {
      projectSlug: project.slug,
      deployToken: project.deployToken,
      autoCreate: false,
      layouts: [
        {
          layoutId: layout.layoutId,
          description: "",
          blocks: [{ type: "card", content: { cards: [{ count: 2 }] }, settings: {} }],
        },
      ],
    });
    const block = await db.select().from(blocks).where(eq(blocks.layoutId, layout.id)).get();
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
