import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createProjectFixture,
  createServiceContext,
  openDevelopmentDraft,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blockDefinitions, blocks, layouts, pages, repeatableItems } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { blocksOfLayout } from "../layouts/identity";
import { syncLayouts } from "../layouts/service";
import { initializeProjectContent } from "./service";

async function fixture(suffix: string) {
  const base = await createProjectFixture(`bootstrap-validation-${suffix}`);
  const ctx = createServiceContext(base.db, base.memberUser);
  await runService(
    upsertBlockDefinition(ctx, {
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
    }),
  );
  return { ...base, ctx };
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
  it("validates a development draft's layouts against its own definitions, not Live's", async () => {
    const { db, ctx, project } = await fixture("development-draft");
    const draftId = await openDevelopmentDraft(db, project.id, ctx.user!.id);
    // Live's card accepts any count from 0; the development draft's code now asks for 10 or more.
    await db
      .update(blockDefinitions)
      .set({
        contentSchema: {
          type: "object",
          properties: { count: { type: "integer", minimum: 10 } },
        },
      })
      .where(and(eq(blockDefinitions.draftId, draftId), eq(blockDefinitions.blockId, "card")));
    const before = await snapshot(db);
    await expect(
      runService(
        syncLayouts(
          { ...ctx, draft: { development: true } },
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
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await snapshot(db)).toEqual(before);
  });

  it("preflights all layouts before metadata updates, inserts or deletions", async () => {
    const { db, ctx, project, layout } = await fixture("layouts");
    const before = await snapshot(db);
    await expect(
      runService(
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
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await snapshot(db)).toEqual(before);
  });

  it("rejects invalid settings before creating the homepage or earlier blocks", async () => {
    const { db, ctx, project, layout } = await fixture("settings");
    const before = await snapshot(db);
    await expect(
      runService(
        initializeProjectContent(ctx, {
          projectSlug: project.slug,
          deployToken: project.deployToken,
          layoutId: layout.layoutId,
          blocks: [
            { type: "card", content: { count: 1 } },
            { type: "card", content: {}, settings: { theme: "invalid" } },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await snapshot(db)).toEqual(before);
  });

  it("rejects invalid explicit repeatable seeds before creating the homepage", async () => {
    const { db, ctx, project, layout } = await fixture("seeds");
    const before = await snapshot(db);
    await expect(
      runService(
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
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await snapshot(db)).toEqual(before);
  });

  it("persists defaults and normalized inline repeaters for layout blocks", async () => {
    const { db, ctx, project, layout } = await fixture("defaults");
    await runService(
      syncLayouts(ctx, {
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
      }),
    );
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
