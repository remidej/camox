import { queryKeys } from "@camox/api-contract/query-keys";
import { eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { blocksProvider } from "../../../../../packages/ai-tools/src/providers/blocks";
import {
  createProjectFixture,
  createServiceContext,
  seedLiveThrough,
  syncDefinitionSet,
  type TestDefinitionSet,
  inScope,
} from "../../../test/fixtures";
import { forgetSent, refreshes, sentTo } from "../../../test/project-rooms";
import { runService } from "../../lib/run-service";
import { blocks, layouts, pages, repeatableItems } from "../../schema";
import { blocksOfLayout } from "../layouts/identity";
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

type Definition = NonNullable<TestDefinitionSet["blocks"]>[number];

async function fixture(suffix: string, synced?: boolean) {
  const base = await createProjectFixture(suffix);
  const ctx = createServiceContext(base.db, base.memberUser);
  const definition = {
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
  // The definitions Live holds, by name: a release sends them all.
  const released = new Map<string, Definition>([[definition.blockId, definition]]);
  /** Releases `changed` alongside every definition released before, leaving layouts as they are. */
  const release = (...changed: Definition[]) => {
    for (const def of changed) released.set(def.blockId, def);
    return syncDefinitionSet(base.db, base.project, { blocks: [...released.values()] });
  };
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
  await syncDefinitionSet(base.db, base.project, {
    blocks: [definition],
    layouts: layoutDefinitions,
  });
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
  return { ...base, ctx, release, definition, first, second, otherLayout, page };
}

describe("a synced block's shared content", () => {
  it("shows an edit made through one placement in every placement, each keeping its position and slot", async () => {
    const { ctx, first, second, project } = await fixture("shared-edit", true);
    const parent = (
      await runService(getBlock(inScope(ctx, null), { id: first.id }))
    ).repeatableItems.find((item) => item.parentItemId === null)!;

    await seedLiveThrough(ctx, project.id, (draft) =>
      updateBlockContent(inScope(ctx, draft), { id: first.id, content: { title: "Shared" } }),
    );
    await seedLiveThrough(ctx, project.id, (draft) =>
      updateBlockSettings(inScope(ctx, draft), { id: second.id, settings: { sticky: false } }),
    );
    await seedLiveThrough(ctx, project.id, (draft) =>
      updateRepeatableItemContent(inScope(ctx, draft), {
        id: parent.id,
        content: { label: "Start" },
      }),
    );
    const added = await seedLiveThrough(ctx, project.id, (draft) =>
      createRepeatableItem(inScope(ctx, draft), {
        blockId: second.id,
        fieldName: "links",
        content: { label: "New" },
      }),
    );
    await seedLiveThrough(ctx, project.id, (draft) =>
      updateRepeatableItemPosition(inScope(ctx, draft), { id: added.id, beforePosition: "a0" }),
    );

    for (const placement of [first, second]) {
      const { block, repeatableItems: items } = await runService(
        getBlock(inScope(ctx, null), { id: placement.id }),
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

    await seedLiveThrough(ctx, project.id, (draft) =>
      deleteRepeatableItem(inScope(ctx, draft), { id: added.id }),
    );
    expect(
      (await runService(getBlock(inScope(ctx, null), { id: first.id }))).repeatableItems.map(
        (item) => item.id,
      ),
    ).not.toContain(added.id);
  });

  it("returns the shared content from placement writes that don't touch it", async () => {
    const { ctx, page, first, project } = await fixture("shared-write-results", true);
    await seedLiveThrough(ctx, project.id, (draft) =>
      updateBlockContent(inScope(ctx, draft), { id: first.id, content: { title: "Shared" } }),
    );
    const placed = await seedLiveThrough(ctx, project.id, (draft) =>
      createBlock(inScope(ctx, draft), { pageId: page.id, type: "navbar", content: {} }),
    );
    const expected = { content: { title: "Shared" }, settings: { sticky: true } };

    expect(
      await seedLiveThrough(ctx, project.id, (draft) =>
        duplicateBlock(inScope(ctx, draft), { id: placed.id }),
      ),
    ).toMatchObject(expected);
    expect(
      await seedLiveThrough(ctx, project.id, (draft) =>
        updateBlockPosition(inScope(ctx, draft), { id: placed.id, beforePosition: null }),
      ),
    ).toMatchObject(expected);
  });

  it("stores nothing but identity, position and slot in placements, and no sync key", async () => {
    const { db, ctx, page, first, second, project } = await fixture("shared-storage", true);
    const onPage = await seedLiveThrough(ctx, project.id, (draft) =>
      createBlock(inScope(ctx, draft), {
        pageId: page.id,
        type: "navbar",
        content: { title: "Own" },
      }),
    );
    const duplicate = await seedLiveThrough(ctx, project.id, (draft) =>
      duplicateBlock(inScope(ctx, draft), { id: onPage.id }),
    );
    await seedLiveThrough(ctx, project.id, (draft) =>
      updateBlockContent(inScope(ctx, draft), { id: duplicate.id, content: { title: "Shared" } }),
    );

    const ids = [first.id, second.id, onPage.id, duplicate.id];
    const placements = await db.select().from(blocks).where(inArray(blocks.id, ids));
    expect(placements.map(({ content, settings }) => ({ content, settings }))).toEqual(
      ids.map(() => ({ content: {}, settings: null })),
    );
    expect(
      await db.select().from(repeatableItems).where(inArray(repeatableItems.blockId, ids)),
    ).toEqual([]);
    expect(
      (await runService(getBlock(inScope(ctx, null), { id: onPage.id }))).block.content,
    ).toMatchObject({
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
    const { db, ctx, release, definition, first, second, project } = await fixture("become-synced");
    await seedLiveThrough(ctx, project.id, (draft) =>
      updateBlockContent(inScope(ctx, draft), { id: second.id, content: { title: "Older" } }),
    );
    await tick();
    const firstItems = (await runService(getBlock(inScope(ctx, null), { id: first.id })))
      .repeatableItems;
    const firstChild = firstItems.find((item) => item.parentItemId !== null)!;
    // Publishing an item of the first placement makes it the most recently published one.
    await seedLiveThrough(ctx, project.id, (draft) =>
      updateRepeatableItemContent(inScope(ctx, draft), {
        id: firstChild.id,
        content: { label: "Latest" },
      }),
    );

    await release({ ...definition, synced: true });

    for (const placement of [first, second]) {
      const { block, repeatableItems: items } = await runService(
        getBlock(inScope(ctx, null), { id: placement.id }),
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
    const { ctx, release, definition, page, project } = await fixture("created-synced");
    const hero = {
      ...definition,
      blockId: "hero",
      title: "Hero",
      synced: true,
      defaultContent: { title: "Default title" },
    };
    await release(hero);

    const first = await seedLiveThrough(ctx, project.id, (draft) =>
      createBlock(inScope(ctx, draft), {
        pageId: page.id,
        type: "hero",
        content: { title: "First title" },
      }),
    );
    const second = await seedLiveThrough(ctx, project.id, (draft) =>
      createBlock(inScope(ctx, draft), {
        pageId: page.id,
        type: "hero",
        content: { title: "Second title" },
      }),
    );

    for (const placed of [first, second]) {
      expect(
        (await runService(getBlock(inScope(ctx, null), { id: placed.id }))).block.content,
      ).toMatchObject({
        title: "First title",
      });
    }
  });

  it("builds the shared content from the definition's defaults when nothing places it", async () => {
    const { ctx, release, definition, page, project } = await fixture("become-synced-defaults");
    const hero = {
      ...definition,
      blockId: "hero",
      title: "Hero",
      defaultContent: { title: "Default title" },
      defaultSettings: { sticky: true },
    };
    await release(hero);

    await release({ ...hero, synced: true });
    const placed = await seedLiveThrough(ctx, project.id, (draft) =>
      createBlock(inScope(ctx, draft), {
        pageId: page.id,
        type: "hero",
        content: { title: "Own title" },
      }),
    );

    expect((await runService(getBlock(inScope(ctx, null), { id: placed.id }))).block).toMatchObject(
      {
        content: { title: "Default title" },
        settings: { sticky: true },
      },
    );
  });
});

describe("a definition sync making a block no longer synced", () => {
  it("gives each placement its own copy, with distinct repeatable item ids, and deletes the shared content", async () => {
    const { db, ctx, release, project, definition, first, second } = await fixture(
      "stop-synced",
      true,
    );
    await seedLiveThrough(ctx, project.id, (draft) =>
      updateBlockContent(inScope(ctx, draft), { id: first.id, content: { title: "Shared" } }),
    );
    const sharedIds = (
      await runService(getBlock(inScope(ctx, null), { id: first.id }))
    ).repeatableItems.map((item) => item.id);

    await release({ ...definition, synced: false });

    const [firstCopy, secondCopy] = await Promise.all(
      [first, second].map((placement) =>
        runService(getBlock(inScope(ctx, null), { id: placement.id })),
      ),
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

    await seedLiveThrough(ctx, project.id, (draft) =>
      updateBlockContent(inScope(ctx, draft), { id: second.id, content: { title: "Own" } }),
    );
    expect(
      (await runService(getBlock(inScope(ctx, null), { id: first.id }))).block.content,
    ).toMatchObject({
      title: "Shared",
    });
    expect(
      await runService(
        getSyncedBlockContent(inScope(ctx, null), { projectId: project.id, type: "navbar" }),
      ),
    ).toBeNull();
    expect(
      await db.select().from(repeatableItems).where(inArray(repeatableItems.id, sharedIds)),
    ).toEqual([]);
  });
});

describe("reading a synced placement", () => {
  it("shows the shared content through its own read, Markdown and AI tools", async () => {
    const { ctx, project, page, second } = await fixture("shared-readers", true);
    const onPage = await seedLiveThrough(ctx, project.id, (draft) =>
      createBlock(inScope(ctx, draft), { pageId: page.id, type: "navbar", content: {} }),
    );
    const context = { ...ctx, projectId: project.id };
    const tools = await blocksProvider(context);
    const tool = (name: string) => tools.find((entry) => entry.name === name)!;

    // Agents write in a draft, which publishing applies to Live.
    await seedLiveThrough(ctx, project.id, (_draft, inDraft) =>
      Effect.promise(async () => {
        const draftContext = { ...inDraft, projectId: project.id };
        const editBlock = (await blocksProvider(draftContext)).find(
          (entry) => entry.name === "editBlock",
        )!;
        await editBlock.handler(
          { id: second.id, content: { title: "Shared title" } },
          draftContext,
        );
      }),
    );

    const catalog = await runService(
      getSyncedBlockContent(inScope(ctx, null), { projectId: project.id, type: "navbar" }),
    );
    expect(catalog?.block.content).toMatchObject({ title: "Shared title" });
    expect(
      (await runService(getPageMarkdown(inScope(ctx, null), { pageId: page.id }))).markdown,
    ).toContain("# Shared title");
    expect(
      (
        await runService(
          getLayoutMarkdown(inScope(ctx, null), { projectUuid: project.uuid, layoutId: "other" }),
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
    await seedLiveThrough(ctx, project.id, (draft) =>
      updateBlockContent(inScope(ctx, draft), {
        id: second.id,
        content: { title: "Shared title" },
      }),
    );

    const shared = await runService(
      getSyncedBlockContent(inScope(ctx, null), { projectId: project.id, type: "navbar" }),
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
      await runService(
        getSyncedBlockContent(inScope(ctx, null), { projectId: project.id, type: "navbar" }),
      ),
      "placed, but not synced",
    ).toBeNull();
    expect(
      await runService(
        getSyncedBlockContent(inScope(ctx, null), { projectId: project.id, type: "hero" }),
      ),
      "never placed",
    ).toBeNull();
  });
});

describe("toggling a Synced Block", () => {
  it("refreshes the shared content when syncing turns on or off, even with fewer than two placements", async () => {
    const { release, project, definition } = await fixture("synced-toggle-invalidation");
    const hero = { ...definition, blockId: "hero", title: "Hero" };
    const refreshedSyncedContent = (type: string) =>
      refreshes(sentTo(project.id), null, queryKeys.blocks.getSyncedContent(type));

    for (const synced of [true, false]) {
      forgetSent(project.id);
      await release({ ...hero, synced });
      expect(refreshedSyncedContent("hero"), `hero synced: ${synced}`).toBe(true);
    }

    for (const synced of [true, false]) {
      forgetSent(project.id);
      await release({ ...definition, synced }, { ...hero, synced: false });
      expect(refreshedSyncedContent("navbar"), `navbar synced: ${synced}`).toBe(true);
    }
  });
});
