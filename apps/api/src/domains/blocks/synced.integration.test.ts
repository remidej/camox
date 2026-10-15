import { queryKeys, type QueryKey } from "@camox/api-contract/query-keys";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, environments, layouts, pages, repeatableItems } from "../../schema";
import { syncBlockDefinitions, upsertBlockDefinition } from "../block-definitions/service";
import { blocksOfLayout } from "../layouts/identity";
import { getLayout, syncLayouts } from "../layouts/service";
import {
  createRepeatableItem,
  deleteRepeatableItem,
  updateRepeatableItemContent,
  updateRepeatableItemPosition,
  updateRepeatableItemSettings,
} from "../repeatable-items/service";
import {
  createBlock,
  deleteBlock,
  duplicateBlock,
  getBlock,
  getSyncedBlockContent,
  updateBlockContent,
  updateBlockSettings,
} from "./service";

const { broadcastInvalidation } = vi.hoisted(() => {
  vi.resetModules();
  return { broadcastInvalidation: vi.fn<(options: { targets: QueryKey[] }) => void>() };
});
vi.mock("../../lib/broadcast-invalidation", () => ({ broadcastInvalidation }));

async function fixture(suffix: string, synced?: boolean) {
  const base = await createProjectFixture(suffix);
  const ctx = createServiceContext(base.db, base.memberUser);
  const syncCtx = createServiceContext(base.db, null);
  const definition = {
    projectSlug: base.project.slug,
    deployToken: base.project.deployToken,
    blockId: "navbar",
    title: "Navbar",
    description: "Navigation",
    synced,
    contentSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        links: {
          type: "array",
          fieldType: "Repeater",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              children: {
                type: "array",
                fieldType: "Repeater",
                items: { type: "object", properties: { label: { type: "string" } } },
                itemSettingsSchema: {
                  type: "object",
                  properties: { visible: { type: "boolean" } },
                },
              },
            },
          },
        },
      },
    },
    settingsSchema: { type: "object", properties: { sticky: { type: "boolean" } } },
  };
  await runService(upsertBlockDefinition(syncCtx, definition));
  const layoutDefinitions = ["default", "other"].map((layoutId) => ({
    layoutId,
    description: "Layout",
    blocks: [
      {
        type: "navbar",
        slot: "before" as const,
        content: { title: layoutId },
        settings: { sticky: true },
        repeatableItems: [
          {
            tempId: "parent",
            parentTempId: null,
            fieldName: "links",
            content: { label: "Home" },
            position: "a0",
          },
          {
            tempId: "child",
            parentTempId: "parent",
            fieldName: "children",
            content: { label: "Nested" },
            position: "a0",
          },
        ],
      },
    ],
  }));
  await runService(
    syncLayouts(syncCtx, {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      autoCreate: false,
      layouts: layoutDefinitions,
    }),
  );
  const rows = await base.db
    .select()
    .from(layouts)
    .where(eq(layouts.environmentId, base.environment.id));
  const first = (await base.db.select().from(blocks).where(blocksOfLayout(base.layout)).get())!;
  const otherLayout = rows.find((row) => row.layoutId === "other")!;
  const second = (await base.db.select().from(blocks).where(blocksOfLayout(otherLayout)).get())!;
  return { ...base, ctx, syncCtx, definition, first, second, otherLayout };
}

describe("synced blocks", () => {
  it("defaults to independent data, reconciles when enabled, and detaches when disabled", async () => {
    const { ctx, syncCtx, definition, first, second } = await fixture("sync-toggle");
    await runService(updateBlockContent(ctx, { id: first.id, content: { title: "Edited" } }));
    expect((await runService(getBlock(ctx, { id: second.id }))).block.content).toMatchObject({
      title: "other",
    });
    await runService(upsertBlockDefinition(syncCtx, { ...definition, synced: true }));
    expect((await runService(getBlock(ctx, { id: second.id }))).block.content).toMatchObject({
      title: "Edited",
    });
    await runService(upsertBlockDefinition(syncCtx, { ...definition, synced: false }));
    await runService(updateBlockContent(ctx, { id: second.id, content: { title: "Independent" } }));
    expect((await runService(getBlock(ctx, { id: first.id }))).block.content).toMatchObject({
      title: "Edited",
    });
  });

  it("shares nested data and settings bidirectionally without changing placement or item identity", async () => {
    const { db, ctx, first, second } = await fixture("sync-tree", true);
    expect(second.content).toEqual(first.content);
    const firstBundle = await runService(getBlock(ctx, { id: first.id }));
    const secondBundle = await runService(getBlock(ctx, { id: second.id }));
    const firstChild = firstBundle.repeatableItems.find((item) => item.parentItemId !== null)!;
    const secondChild = secondBundle.repeatableItems.find((item) => item.parentItemId !== null)!;
    expect(firstChild.id).not.toBe(secondChild.id);
    await runService(
      updateRepeatableItemContent(ctx, {
        id: secondChild.id,
        content: { label: "Shared child" },
      }),
    );
    await runService(
      updateRepeatableItemSettings(ctx, { id: firstChild.id, settings: { visible: false } }),
    );
    await runService(updateBlockSettings(ctx, { id: second.id, settings: { sticky: false } }));
    await runService(updateBlockContent(ctx, { id: first.id, content: { title: "Shared title" } }));
    const result = await runService(getBlock(ctx, { id: second.id }));
    expect(result.block).toMatchObject({
      layoutId: second.layoutId,
      position: second.position,
      content: { title: "Shared title" },
      settings: { sticky: false },
    });
    expect(result.repeatableItems.find((item) => item.id === secondChild.id)).toMatchObject({
      content: { label: "Shared child" },
      settings: { visible: false },
    });
    const added = await runService(
      createRepeatableItem(ctx, {
        blockId: second.id,
        fieldName: "links",
        content: { label: "New" },
      }),
    );
    await runService(updateRepeatableItemPosition(ctx, { id: added.id, beforePosition: "a0" }));
    const copied = (
      await db.select().from(repeatableItems).where(eq(repeatableItems.blockId, first.id))
    ).find((item) => (item.content as { label: string }).label === "New")!;
    expect(copied.position < "a0").toBe(true);
    await runService(deleteRepeatableItem(ctx, { id: added.id }));
    expect(
      await db.select().from(repeatableItems).where(eq(repeatableItems.id, copied.id)),
    ).toEqual([]);
    await runService(deleteBlock(ctx, { id: first.id }));
    expect((await runService(getBlock(ctx, { id: second.id }))).block.content).toMatchObject({
      title: "Shared title",
    });
  });

  it("reuses data for new page placements and duplicates, without crossing environments", async () => {
    const { db, ctx, project, environment, layout, first } = await fixture("sync-scope", true);
    const now = Date.now();
    const page = await db
      .insert(pages)
      .values({
        projectId: project.id,
        environmentId: environment.id,
        layoutId: layout.layoutId,
        pathSegment: "",
        fullPath: "/",
        nickname: "Home",
        contentUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const otherEnvironment = await db
      .insert(environments)
      .values({
        projectId: project.id,
        name: "dev",
        type: "development",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const otherLayout = await db
      .insert(layouts)
      .values({
        projectId: project.id,
        environmentId: otherEnvironment.id,
        layoutId: "default",
        contentUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const isolated = await db
      .insert(blocks)
      .values({
        environmentId: otherEnvironment.id,
        layoutId: otherLayout.layoutId,
        type: "navbar",
        content: { title: "Isolated" },
        position: "a0",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    await runService(updateBlockContent(ctx, { id: first.id, content: { title: "Existing" } }));
    const created = await runService(
      createBlock(ctx, {
        pageId: page.id,
        type: "navbar",
        content: { title: "Ignored seed" },
      }),
    );
    expect(created.content).toEqual({ title: "Existing" });
    const duplicate = await runService(duplicateBlock(ctx, { id: created.id }));
    expect((await runService(getBlock(ctx, { id: duplicate.id }))).repeatableItems).toHaveLength(2);
    await runService(
      updateBlockContent(ctx, { id: duplicate.id, content: { title: "From page" } }),
    );
    expect((await runService(getBlock(ctx, { id: first.id }))).block.content).toMatchObject({
      title: "From page",
    });
    expect(
      (await db.select().from(blocks).where(eq(blocks.id, isolated.id)).get())?.content,
    ).toEqual({ title: "Isolated" });
  });

  it("renders the current shared content in every placement, for visitors too", async () => {
    const { db, ctx, project, second } = await fixture("sync-current", true);
    await runService(updateBlockContent(ctx, { id: second.id, content: { title: "Shared" } }));

    const visitorCtx = createServiceContext(db, null);
    for (const layoutId of ["default", "other"]) {
      const view = await runService(getLayout(visitorCtx, { projectSlug: project.slug, layoutId }));
      expect(view.blocks[0].content, layoutId).toMatchObject({ title: "Shared" });
      expect(view.repeatableItems, layoutId).toHaveLength(2);
    }
  });
});

describe("getSyncedBlockContent", () => {
  it("returns a Synced Block's shared draft content", async () => {
    const { ctx, project, second } = await fixture("synced-content", true);
    await runService(
      updateBlockContent(ctx, { id: second.id, content: { title: "Shared title" } }),
    );

    const shared = await runService(
      getSyncedBlockContent(ctx, { projectId: project.id, type: "navbar" }),
    );

    expect(shared?.block).toMatchObject({ type: "navbar", content: { title: "Shared title" } });
    expect(shared?.block.settings).toEqual({ sticky: true });
    expect(shared?.repeatableItems.map((item) => item.content)).toEqual([
      expect.objectContaining({ label: "Home" }),
      expect.objectContaining({ label: "Nested" }),
    ]);
  });

  it("returns nothing for a block that isn't synced or isn't placed", async () => {
    const { ctx, project } = await fixture("synced-content-none");

    expect(
      await runService(getSyncedBlockContent(ctx, { projectId: project.id, type: "navbar" })),
      "placed, but not synced",
    ).toBeNull();
    expect(
      await runService(getSyncedBlockContent(ctx, { projectId: project.id, type: "hero" })),
      "never placed",
    ).toBeNull();
  });
});

describe("toggling a Synced Block", () => {
  const invalidatedSyncedContent = (type: string) => {
    const key = JSON.stringify(queryKeys.blocks.getSyncedContent(type));
    return vi
      .mocked(broadcastInvalidation)
      .mock.calls.some(([{ targets }]) => targets.some((target) => JSON.stringify(target) === key));
  };

  it("invalidates the shared content when syncing turns on or off, even with fewer than two placements", async () => {
    const { syncCtx, project, definition } = await fixture("synced-toggle-invalidation");
    const hero = { ...definition, blockId: "hero", title: "Hero" };

    for (const synced of [true, false]) {
      vi.mocked(broadcastInvalidation).mockClear();
      await runService(upsertBlockDefinition(syncCtx, { ...hero, synced }));
      expect(invalidatedSyncedContent("hero"), `upsert synced: ${synced}`).toBe(true);
    }

    for (const synced of [true, false]) {
      vi.mocked(broadcastInvalidation).mockClear();
      await runService(
        syncBlockDefinitions(syncCtx, {
          projectSlug: project.slug,
          deployToken: project.deployToken,
          autoCreate: false,
          definitions: [
            { ...definition, synced },
            { ...hero, synced: false },
          ],
        }),
      );
      expect(invalidatedSyncedContent("navbar"), `sync synced: ${synced}`).toBe(true);
    }
  });

  it("doesn't invalidate the shared content when the synced flag is unchanged", async () => {
    const { syncCtx, definition } = await fixture("synced-unchanged-invalidation", true);
    vi.mocked(broadcastInvalidation).mockClear();

    await runService(upsertBlockDefinition(syncCtx, { ...definition, synced: true }));

    expect(invalidatedSyncedContent("navbar")).toBe(false);
  });
});
