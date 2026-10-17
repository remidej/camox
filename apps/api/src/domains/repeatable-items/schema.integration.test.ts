import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, drafts, layouts, pages, repeatableItems } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import {
  createRepeatableItem,
  deleteRepeatableItem,
  duplicateRepeatableItem,
  updateRepeatableItemContent,
  updateRepeatableItemSettings,
} from "./service";

const settingsSchema = {
  type: "object",
  required: ["enabled"],
  properties: { enabled: { type: "boolean", default: true } },
};
const child = {
  type: "array",
  fieldType: "Repeater",
  items: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string", default: "Child" } },
  },
  itemSettingsSchema: settingsSchema,
};

async function fixture(suffix: string) {
  const base = await createProjectFixture(`direct-schema-${suffix}`);
  const ctx = createServiceContext(base.db, base.memberUser);
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      blockId: "list",
      title: "List",
      description: "Direct item validation",
      contentSchema: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            fieldType: "Repeater",
            minItems: 1,
            maxItems: 2,
            itemSettingsSchema: settingsSchema,
            items: {
              type: "object",
              required: ["title", "count"],
              properties: {
                title: { type: "string", default: "Entry" },
                count: { type: "number", minimum: 0 },
                children: child,
              },
              allOf: [{ properties: { title: { minLength: 2 } } }],
            },
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
  const block = await base.db
    .insert(blocks)
    .values({
      projectId: base.project.id,
      pageId: page.id,
      type: "list",
      content: {},
      settings: {},
      position: "a0",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  // Items are written in a draft: Live is read-only.
  const created = await base.db
    .insert(drafts)
    .values({
      projectId: base.project.id,
      kind: "regular",
      createdBy: base.memberUser.id,
      createdAt: now,
    })
    .returning()
    .get();
  const draft = { id: created.id, kind: created.kind, projectId: created.projectId };
  return { ...base, ctx, block, draft };
}

async function unchanged(
  db: Awaited<ReturnType<typeof fixture>>["db"],
  write: () => Promise<unknown>,
) {
  const snapshot = async () => ({
    blocks: await db.select().from(blocks),
    items: await db.select().from(repeatableItems),
    pages: await db.select().from(pages),
    layouts: await db.select().from(layouts),
  });
  const before = await snapshot();
  await expect(write()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await snapshot()).toEqual(before);
}

describe("direct repeatable item schema enforcement", () => {
  it("initializes scalar defaults and enforces full item constraints without hiding malformed roots", async () => {
    const { db, ctx, block, draft } = await fixture("create");
    for (const content of [null, [], 2, {}, { count: -1 }, { title: "x", count: 1 }]) {
      await unchanged(db, () =>
        runService(
          createRepeatableItem(
            ctx,
            {
              blockId: block.id,
              fieldName: "entries",
              content,
            },
            draft,
          ),
        ),
      );
    }
    for (const settings of [[], false, { enabled: "yes" }]) {
      await unchanged(db, () =>
        runService(
          createRepeatableItem(
            ctx,
            {
              blockId: block.id,
              fieldName: "entries",
              content: { count: 1 },
              settings,
            },
            draft,
          ),
        ),
      );
    }
    const item = await runService(
      createRepeatableItem(
        ctx,
        {
          blockId: block.id,
          fieldName: "entries",
          content: { count: 1 },
          settings: {},
        },
        draft,
      ),
    );
    expect(item.content).toEqual({ title: "Entry", count: 1 });
    expect(item.settings).toEqual({ enabled: true });
    expect(await db.select().from(repeatableItems)).toHaveLength(1);
    const withoutSettings = await runService(
      createRepeatableItem(
        ctx,
        {
          blockId: block.id,
          fieldName: "entries",
          content: { count: 1 },
          settings: null,
        },
        draft,
      ),
    );
    expect(withoutSettings.settings).toEqual({ enabled: true });
  });

  it("validates all nested seed settings before creating any rows", async () => {
    const { db, ctx, block, draft } = await fixture("seeds");
    await unchanged(db, () =>
      runService(
        createRepeatableItem(
          ctx,
          {
            blockId: block.id,
            fieldName: "entries",
            content: { count: 1 },
            nestedItems: [
              {
                tempId: "first",
                parentTempId: null,
                fieldName: "children",
                content: {},
                position: "a0",
              },
              {
                tempId: "second",
                parentTempId: null,
                fieldName: "children",
                content: { name: "Valid" },
                settings: { enabled: "no" },
                position: "a1",
              },
            ],
          },
          draft,
        ),
      ),
    );
    const root = await runService(
      createRepeatableItem(
        ctx,
        {
          blockId: block.id,
          fieldName: "entries",
          content: { count: 1 },
          nestedItems: [
            {
              tempId: "first",
              parentTempId: null,
              fieldName: "children",
              content: {},
              settings: {},
              position: "a0",
            },
          ],
        },
        draft,
      ),
    );
    const childRow = (await db.select().from(repeatableItems)).find(
      (row) => row.parentItemId === root.id,
    );
    expect(childRow?.content).toEqual({ name: "Child" });
    expect(childRow?.settings).toEqual({ enabled: true });
  });

  it("validates only submitted update fields and keeps historical invalid fields", async () => {
    const { db, ctx, block, draft } = await fixture("patch");
    const item = await runService(
      createRepeatableItem(
        ctx,
        {
          blockId: block.id,
          fieldName: "entries",
          content: { count: 1 },
        },
        draft,
      ),
    );
    await db
      .update(repeatableItems)
      .set({
        content: { title: false, count: 1 },
        settings: { historical: "unchanged", enabled: "old" },
      })
      .where(eq(repeatableItems.id, item.id));
    await unchanged(db, () =>
      runService(
        updateRepeatableItemContent(ctx, { id: item.id, content: { count: "bad" } }, draft),
      ),
    );
    await unchanged(db, () =>
      runService(
        updateRepeatableItemSettings(ctx, { id: item.id, settings: { enabled: 1 } }, draft),
      ),
    );
    await runService(
      updateRepeatableItemContent(ctx, { id: item.id, content: { count: 2 } }, draft),
    );
    await runService(
      updateRepeatableItemSettings(
        ctx,
        { id: item.id, settings: { historical: "updated" } },
        draft,
      ),
    );
    const updated = await db
      .select()
      .from(repeatableItems)
      .where(eq(repeatableItems.id, item.id))
      .get();
    expect(updated?.content).toEqual({ title: false, count: 2 });
    expect(updated?.settings).toEqual({ historical: "updated", enabled: "old" });
  });

  it("enforces counts and rejects a nonexistent parent without mutating rows", async () => {
    const { db, ctx, block, draft } = await fixture("counts");
    await unchanged(db, () =>
      runService(
        createRepeatableItem(
          ctx,
          {
            blockId: block.id,
            parentItemId: "999999",
            fieldName: "entries",
            content: { count: 1 },
          },
          draft,
        ),
      ),
    );
    const first = await runService(
      createRepeatableItem(
        ctx,
        {
          blockId: block.id,
          fieldName: "entries",
          content: { count: 1 },
        },
        draft,
      ),
    );
    await unchanged(db, () => runService(deleteRepeatableItem(ctx, { id: first.id }, draft)));
    const second = await runService(duplicateRepeatableItem(ctx, { id: first.id }, draft));
    await unchanged(db, () => runService(duplicateRepeatableItem(ctx, { id: first.id }, draft)));
    await unchanged(db, () =>
      runService(
        createRepeatableItem(
          ctx,
          {
            blockId: block.id,
            fieldName: "entries",
            content: { count: 1 },
          },
          draft,
        ),
      ),
    );
    await runService(deleteRepeatableItem(ctx, { id: second.id }, draft));
  });
});
