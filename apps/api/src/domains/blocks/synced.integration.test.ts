import { queryKeys, type QueryKey } from "@camox/api-contract/query-keys";
import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { blocksProvider } from "../../../../../packages/ai-tools/src/providers/blocks";
import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, layouts, pages, repeatableItems } from "../../schema";
import { syncBlockDefinitions, upsertBlockDefinition } from "../block-definitions/service";
import { blocksOfLayout } from "../layouts/identity";
import { syncLayouts } from "../layouts/service";
import {
  createRepeatableItem,
  deleteRepeatableItem,
  updateRepeatableItemContent,
  updateRepeatableItemPosition,
} from "../repeatable-items/service";
import {
  createBlock,
  duplicateBlock,
  getBlock,
  getLayoutMarkdown,
  getPageMarkdown,
  getSyncedBlockContent,
  updateBlockContent,
  updateBlockPosition,
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
        title: { type: "string", fieldType: "String" },
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
      toMarkdown: ["# {{title}}"],
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
  const rows = await base.db.select().from(layouts).where(eq(layouts.projectId, base.project.id));
  const first = (await base.db.select().from(blocks).where(blocksOfLayout(base.layout)).get())!;
  const otherLayout = rows.find((row) => row.layoutId === "other")!;
  const second = (await base.db.select().from(blocks).where(blocksOfLayout(otherLayout)).get())!;
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
  return { ...base, ctx, syncCtx, definition, first, second, otherLayout, page };
}

describe("a synced block's shared content", () => {
  it("shows an edit made through one placement in every placement, each keeping its position and slot", async () => {
    const { ctx, first, second } = await fixture("shared-edit", true);
    const parent = (await runService(getBlock(ctx, { id: first.id }, null))).repeatableItems.find(
      (item) => item.parentItemId === null,
    )!;

    await runService(updateBlockContent(ctx, { id: first.id, content: { title: "Shared" } }, null));
    await runService(
      updateBlockSettings(ctx, { id: second.id, settings: { sticky: false } }, null),
    );
    await runService(
      updateRepeatableItemContent(ctx, { id: parent.id, content: { label: "Start" } }, null),
    );
    const added = await runService(
      createRepeatableItem(
        ctx,
        {
          blockId: second.id,
          fieldName: "links",
          content: { label: "New" },
        },
        null,
      ),
    );
    await runService(
      updateRepeatableItemPosition(ctx, { id: added.id, beforePosition: "a0" }, null),
    );

    for (const placement of [first, second]) {
      const { block, repeatableItems: items } = await runService(
        getBlock(ctx, { id: placement.id }, null),
      );
      expect(block, placement.layoutId!).toMatchObject({
        id: placement.id,
        layoutId: placement.layoutId,
        slot: placement.slot,
        position: placement.position,
        content: { title: "Shared" },
        settings: { sticky: false },
      });
      expect(
        items.filter((item) => item.parentItemId === null).map((item) => item.id),
        placement.layoutId!,
      ).toEqual([added.id, parent.id]);
      expect(items.find((item) => item.id === parent.id)?.content).toMatchObject({
        label: "Start",
      });
    }

    await runService(deleteRepeatableItem(ctx, { id: added.id }, null));
    expect(
      (await runService(getBlock(ctx, { id: first.id }, null))).repeatableItems.map(
        (item) => item.id,
      ),
    ).not.toContain(added.id);
  });

  it("returns the shared content from placement writes that don't touch it", async () => {
    const { ctx, page, first } = await fixture("shared-write-results", true);
    await runService(updateBlockContent(ctx, { id: first.id, content: { title: "Shared" } }, null));
    const placed = await runService(
      createBlock(ctx, { pageId: page.id, type: "navbar", content: {} }, null),
    );
    const expected = { content: { title: "Shared" }, settings: { sticky: true } };

    expect(await runService(duplicateBlock(ctx, { id: placed.id }, null))).toMatchObject(expected);
    expect(
      await runService(updateBlockPosition(ctx, { id: placed.id, beforePosition: null }, null)),
    ).toMatchObject(expected);
  });

  it("stores nothing but identity, position and slot in placements, and no sync key", async () => {
    const { db, ctx, page, first, second } = await fixture("shared-storage", true);
    const onPage = await runService(
      createBlock(ctx, { pageId: page.id, type: "navbar", content: { title: "Own" } }, null),
    );
    const duplicate = await runService(duplicateBlock(ctx, { id: onPage.id }, null));
    await runService(
      updateBlockContent(ctx, { id: duplicate.id, content: { title: "Shared" } }, null),
    );

    const ids = [first.id, second.id, onPage.id, duplicate.id];
    const placements = await db.select().from(blocks).where(inArray(blocks.id, ids));
    expect(placements.map(({ content, settings }) => ({ content, settings }))).toEqual(
      ids.map(() => ({ content: {}, settings: null })),
    );
    expect(
      await db.select().from(repeatableItems).where(inArray(repeatableItems.blockId, ids)),
    ).toEqual([]);
    expect((await runService(getBlock(ctx, { id: onPage.id }, null))).block.content).toMatchObject({
      title: "Shared",
    });

    const columns = await db.all<{ name: string }>(
      sql`select name from pragma_table_info('repeatable_items')`,
    );
    expect(columns.map(({ name }) => name)).not.toContain("sync_key");
  });
});

/** Lets the clock move on, so the next write is strictly the most recent. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("a definition sync making a block synced", () => {
  it("builds the shared content from the most recently updated placement and clears every placement", async () => {
    const { db, ctx, syncCtx, definition, first, second } = await fixture("become-synced");
    await runService(updateBlockContent(ctx, { id: second.id, content: { title: "Older" } }, null));
    await tick();
    const firstItems = (await runService(getBlock(ctx, { id: first.id }, null))).repeatableItems;
    const firstChild = firstItems.find((item) => item.parentItemId !== null)!;
    await runService(
      updateRepeatableItemContent(ctx, { id: firstChild.id, content: { label: "Latest" } }, null),
    );

    await runService(upsertBlockDefinition(syncCtx, { ...definition, synced: true }));

    for (const placement of [first, second]) {
      const { block, repeatableItems: items } = await runService(
        getBlock(ctx, { id: placement.id }, null),
      );
      expect(block.content, placement.layoutId!).toMatchObject({ title: "default" });
      expect(items.map((item) => item.id).sort(), placement.layoutId!).toEqual(
        firstItems.map((item) => item.id).sort(),
      );
      expect(items.find((item) => item.id === firstChild.id)?.content).toMatchObject({
        label: "Latest",
      });
    }
    const stored = await db
      .select()
      .from(blocks)
      .where(inArray(blocks.id, [first.id, second.id]));
    expect(stored.map(({ content, settings }) => ({ content, settings }))).toEqual([
      { content: {}, settings: null },
      { content: {}, settings: null },
    ]);
  });

  it("leaves a new synced definition's shared content to its first placement", async () => {
    const { ctx, syncCtx, definition, page } = await fixture("created-synced");
    const hero = {
      ...definition,
      blockId: "hero",
      title: "Hero",
      synced: true,
      defaultContent: { title: "Default title" },
    };
    await runService(upsertBlockDefinition(syncCtx, hero));

    const first = await runService(
      createBlock(ctx, { pageId: page.id, type: "hero", content: { title: "First title" } }, null),
    );
    const second = await runService(
      createBlock(ctx, { pageId: page.id, type: "hero", content: { title: "Second title" } }, null),
    );

    for (const placed of [first, second]) {
      expect(
        (await runService(getBlock(ctx, { id: placed.id }, null))).block.content,
      ).toMatchObject({
        title: "First title",
      });
    }
  });

  it("builds the shared content from the definition's defaults when nothing places it", async () => {
    const { ctx, syncCtx, definition, page } = await fixture("become-synced-defaults");
    const hero = {
      ...definition,
      blockId: "hero",
      title: "Hero",
      defaultContent: { title: "Default title" },
      defaultSettings: { sticky: true },
    };
    await runService(upsertBlockDefinition(syncCtx, hero));

    await runService(upsertBlockDefinition(syncCtx, { ...hero, synced: true }));
    const placed = await runService(
      createBlock(ctx, { pageId: page.id, type: "hero", content: { title: "Own title" } }, null),
    );

    expect((await runService(getBlock(ctx, { id: placed.id }, null))).block).toMatchObject({
      content: { title: "Default title" },
      settings: { sticky: true },
    });
  });
});

describe("a definition sync making a block no longer synced", () => {
  it("gives each placement its own copy, with distinct repeatable item ids, and deletes the shared content", async () => {
    const { db, ctx, syncCtx, project, definition, first, second } = await fixture(
      "stop-synced",
      true,
    );
    await runService(updateBlockContent(ctx, { id: first.id, content: { title: "Shared" } }, null));
    const sharedIds = (await runService(getBlock(ctx, { id: first.id }, null))).repeatableItems.map(
      (item) => item.id,
    );

    await runService(upsertBlockDefinition(syncCtx, { ...definition, synced: false }));

    const [firstCopy, secondCopy] = await Promise.all(
      [first, second].map((placement) => runService(getBlock(ctx, { id: placement.id }, null))),
    );
    for (const copy of [firstCopy, secondCopy]) {
      expect(copy.block).toMatchObject({
        content: { title: "Shared" },
        settings: { sticky: true },
      });
      // The parent item and its nested item share a position; their order says nothing.
      const labels = copy.repeatableItems.map((item) => (item.content as { label: string }).label);
      expect(labels.sort()).toEqual(["Home", "Nested"]);
    }
    const copiedIds = [...firstCopy.repeatableItems, ...secondCopy.repeatableItems].map(
      (item) => item.id,
    );
    expect(new Set([...copiedIds, ...sharedIds]).size).toBe(copiedIds.length + sharedIds.length);

    await runService(updateBlockContent(ctx, { id: second.id, content: { title: "Own" } }, null));
    expect((await runService(getBlock(ctx, { id: first.id }, null))).block.content).toMatchObject({
      title: "Shared",
    });
    expect(
      await runService(getSyncedBlockContent(ctx, { projectId: project.id, type: "navbar" }, null)),
    ).toBeNull();
    expect(
      await db.select().from(repeatableItems).where(inArray(repeatableItems.id, sharedIds)),
    ).toEqual([]);
  });
});

describe("reading a synced placement", () => {
  it("shows the shared content in the Block Catalog, Markdown and AI tools", async () => {
    const { ctx, project, page, second } = await fixture("shared-readers", true);
    const onPage = await runService(
      createBlock(ctx, { pageId: page.id, type: "navbar", content: {} }, null),
    );
    const context = { ...ctx, projectId: project.id };
    const tools = await blocksProvider(context);
    const tool = (name: string) => tools.find((entry) => entry.name === name)!;

    await tool("editBlock").handler({ id: second.id, content: { title: "Shared title" } }, context);

    const catalog = await runService(
      getSyncedBlockContent(ctx, { projectId: project.id, type: "navbar" }, null),
    );
    expect(catalog?.block.content).toMatchObject({ title: "Shared title" });
    expect((await runService(getPageMarkdown(ctx, { pageId: page.id }, null))).markdown).toContain(
      "# Shared title",
    );
    expect(
      (
        await runService(
          getLayoutMarkdown(ctx, { projectSlug: project.slug, layoutId: "other" }, null),
        )
      ).before,
    ).toContain("# Shared title");
    const fetched = (await tool("getBlock").handler({ id: onPage.id }, context)) as {
      block: { content: unknown };
      repeatableItems: unknown[];
    };
    expect(fetched.block.content).toMatchObject({ title: "Shared title" });
    expect(fetched.repeatableItems).toHaveLength(2);
  });
});

describe("getSyncedBlockContent", () => {
  it("returns a Synced Block's shared draft content", async () => {
    const { ctx, project, second } = await fixture("synced-content", true);
    await runService(
      updateBlockContent(ctx, { id: second.id, content: { title: "Shared title" } }, null),
    );

    const shared = await runService(
      getSyncedBlockContent(ctx, { projectId: project.id, type: "navbar" }, null),
    );

    expect(shared?.block).toMatchObject({ type: "navbar", content: { title: "Shared title" } });
    expect(shared?.block.settings).toEqual({ sticky: true });
    // The parent item and its nested item share a position; their order says nothing.
    const labels = shared?.repeatableItems.map((item) => (item.content as { label: string }).label);
    expect(labels?.sort()).toEqual(["Home", "Nested"]);
  });

  it("returns nothing for a block that isn't synced or isn't placed", async () => {
    const { ctx, project } = await fixture("synced-content-none");

    expect(
      await runService(getSyncedBlockContent(ctx, { projectId: project.id, type: "navbar" }, null)),
      "placed, but not synced",
    ).toBeNull();
    expect(
      await runService(getSyncedBlockContent(ctx, { projectId: project.id, type: "hero" }, null)),
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
