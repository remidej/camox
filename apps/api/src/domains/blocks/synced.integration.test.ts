import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { blocks, environments, layouts, pages, repeatableItems } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { getLayout, publishLayout, syncLayouts, unpublishLayout } from "../layouts/service";
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
  updateBlockContent,
  updateBlockSettings,
} from "./service";

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
    contentSchema: { type: "object", properties: { title: { type: "string" } } },
  };
  await upsertBlockDefinition(syncCtx, definition);
  const layoutDefinitions = ["default", "other"].map((layoutId) => ({
    layoutId,
    description: "Layout",
    blocks: [
      {
        type: "navbar",
        placement: "before" as const,
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
  await syncLayouts(syncCtx, {
    projectSlug: base.project.slug,
    deployToken: base.project.deployToken,
    autoCreate: false,
    layouts: layoutDefinitions,
  });
  const rows = await base.db
    .select()
    .from(layouts)
    .where(eq(layouts.environmentId, base.environment.id));
  const first = (await base.db
    .select()
    .from(blocks)
    .where(eq(blocks.layoutId, base.layout.id))
    .get())!;
  const otherLayout = rows.find((row) => row.layoutId === "other")!;
  const second = (await base.db
    .select()
    .from(blocks)
    .where(eq(blocks.layoutId, otherLayout.id))
    .get())!;
  return { ...base, ctx, syncCtx, definition, first, second, otherLayout };
}

describe("synced blocks", () => {
  it("defaults to independent data, reconciles when enabled, and detaches when disabled", async () => {
    const { ctx, syncCtx, definition, first, second } = await fixture("sync-toggle");
    await updateBlockContent(ctx, { id: first.id, content: { title: "Edited" } });
    expect((await getBlock(ctx, { id: second.id, source: "draft" })).block.content).toMatchObject({
      title: "other",
    });
    await upsertBlockDefinition(syncCtx, { ...definition, synced: true });
    expect((await getBlock(ctx, { id: second.id, source: "draft" })).block.content).toMatchObject({
      title: "Edited",
    });
    await upsertBlockDefinition(syncCtx, { ...definition, synced: false });
    await updateBlockContent(ctx, { id: second.id, content: { title: "Independent" } });
    expect((await getBlock(ctx, { id: first.id, source: "draft" })).block.content).toMatchObject({
      title: "Edited",
    });
  });

  it("shares nested data and settings bidirectionally without changing placement or item identity", async () => {
    const { db, ctx, first, second } = await fixture("sync-tree", true);
    expect(second.content).toEqual(first.content);
    const firstBundle = await getBlock(ctx, { id: first.id, source: "draft" });
    const secondBundle = await getBlock(ctx, { id: second.id, source: "draft" });
    const firstChild = firstBundle.repeatableItems.find((item) => item.parentItemId !== null)!;
    const secondChild = secondBundle.repeatableItems.find((item) => item.parentItemId !== null)!;
    expect(firstChild.id).not.toBe(secondChild.id);
    await updateRepeatableItemContent(ctx, {
      id: secondChild.id,
      content: { label: "Shared child" },
    });
    await updateRepeatableItemSettings(ctx, { id: firstChild.id, settings: { visible: false } });
    await updateBlockSettings(ctx, { id: second.id, settings: { sticky: false } });
    await updateBlockContent(ctx, { id: first.id, content: { title: "Shared title" } });
    const result = await getBlock(ctx, { id: second.id, source: "draft" });
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
    const added = await createRepeatableItem(ctx, {
      blockId: second.id,
      fieldName: "links",
      content: { label: "New" },
    });
    await updateRepeatableItemPosition(ctx, { id: added.id, beforePosition: "a0" });
    const copied = (
      await db.select().from(repeatableItems).where(eq(repeatableItems.blockId, first.id))
    ).find((item) => (item.content as { label: string }).label === "New")!;
    expect(copied.position < "a0").toBe(true);
    await deleteRepeatableItem(ctx, { id: added.id });
    expect(
      await db.select().from(repeatableItems).where(eq(repeatableItems.id, copied.id)),
    ).toEqual([]);
    await deleteBlock(ctx, { id: first.id });
    expect((await getBlock(ctx, { id: second.id, source: "draft" })).block.content).toMatchObject({
      title: "Shared title",
    });
  });

  it("reuses data for new page instances and duplicates, without crossing environments", async () => {
    const { db, ctx, project, environment, layout, first } = await fixture("sync-scope", true);
    const now = Date.now();
    const page = await db
      .insert(pages)
      .values({
        projectId: project.id,
        environmentId: environment.id,
        layoutId: layout.id,
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
        layoutId: otherLayout.id,
        type: "navbar",
        content: { title: "Isolated" },
        position: "a0",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    await updateBlockContent(ctx, { id: first.id, content: { title: "Existing" } });
    const created = await createBlock(ctx, {
      pageId: page.id,
      type: "navbar",
      content: { title: "Ignored seed" },
    });
    expect(created.content).toEqual({ title: "Existing" });
    const duplicate = await duplicateBlock(ctx, { id: created.id });
    expect(
      (await getBlock(ctx, { id: duplicate.id, source: "draft" })).repeatableItems,
    ).toHaveLength(2);
    await updateBlockContent(ctx, { id: duplicate.id, content: { title: "From page" } });
    expect((await getBlock(ctx, { id: first.id, source: "draft" })).block.content).toMatchObject({
      title: "From page",
    });
    expect(
      (await db.select().from(blocks).where(eq(blocks.id, isolated.id)).get())?.content,
    ).toEqual({ title: "Isolated" });
  });

  it("publishes shared data everywhere while keeping unpublished edits private", async () => {
    const { ctx, project, layout, otherLayout, first, second } = await fixture("sync-live", true);
    await publishLayout(ctx, { id: layout.id });
    await publishLayout(ctx, { id: otherLayout.id });
    await updateBlockContent(ctx, { id: second.id, content: { title: "New draft" } });
    expect((await getBlock(ctx, { id: first.id })).block.content).toMatchObject({
      title: "default",
    });
    await publishLayout(ctx, { id: otherLayout.id });
    const live = await getLayout(ctx, { projectSlug: project.slug, layoutId: "default" });
    expect(live.blocks[0].content).toMatchObject({ title: "New draft" });
    expect((await getBlock(ctx, { id: first.id })).block.content).toMatchObject({
      title: "New draft",
    });
    expect(live.repeatableItems).toHaveLength(2);
    await updateBlockContent(ctx, { id: first.id, content: { title: "Still private" } });
    expect((await getBlock(ctx, { id: second.id })).block.content).toMatchObject({
      title: "New draft",
    });
    // Removing the publishing placement must not roll back the singleton.
    await unpublishLayout(ctx, { id: otherLayout.id });
    await deleteBlock(ctx, { id: second.id });
    expect((await getBlock(ctx, { id: first.id })).block.content).toMatchObject({
      title: "New draft",
    });
  });
});
