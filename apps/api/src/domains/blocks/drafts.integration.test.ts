import { generateUuidv7 } from "@camox/api-contract/ids";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { drafts, pages, repeatableItems } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { discardDraft } from "../drafts/publish";
import type { DraftScope } from "../drafts/scope";
import { getPageByPath } from "../pages/service";
import {
  createBlock,
  deleteBlock,
  deleteBlocks,
  duplicateBlock,
  getBlock,
  getPageMarkdown,
  updateBlockContent,
  updateBlockPosition,
  updateBlockSettings,
} from "./service";

async function fixture(suffix: string) {
  const base = await createProjectFixture(suffix);
  const ctx = createServiceContext(base.db, base.memberUser);
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      blockId: "hero",
      title: "Hero",
      description: "Hero",
      contentSchema: {
        type: "object",
        properties: { title: { fieldType: "String", type: "string" } },
        toMarkdown: ["# {{title}}"],
      },
      settingsSchema: { properties: { dark: { type: "boolean", default: false } } },
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
  const openDraft = async (): Promise<DraftScope> => {
    const draft = await base.db
      .insert(drafts)
      .values({
        projectId: base.project.id,
        kind: "regular",
        createdBy: base.memberUser.id,
        createdAt: Date.now(),
      })
      .returning()
      .get();
    return { id: draft.id, kind: draft.kind, projectId: draft.projectId };
  };
  const create = (title: string, scope: DraftScope = null) =>
    runService(createBlock(ctx, { pageId: page.id, type: "hero", content: { title } }, scope));
  const titleIn = async (id: string, scope: DraftScope) =>
    (await runService(getBlock(ctx, { id }, scope))).block.content.title;
  const pageTitles = async (scope: DraftScope) =>
    (await runService(getPageMarkdown(ctx, { pageId: page.id }, scope))).blocks.map(
      (block) => block.markdown,
    );
  return { ...base, ctx, page, openDraft, create, titleIn, pageTitles };
}

describe("blocks in a draft", () => {
  it("reads a block edited in a draft as changed there, and unchanged on Live and in another draft", async () => {
    const { ctx, openDraft, create, titleIn } = await fixture("draft-edit");
    const block = await create("Live");
    const draft = await openDraft();
    const other = await openDraft();

    await runService(updateBlockContent(ctx, { id: block.id, content: { title: "Draft" } }, draft));

    expect(await titleIn(block.id, draft)).toBe("Draft");
    expect(await titleIn(block.id, null)).toBe("Live");
    expect(await titleIn(block.id, other)).toBe("Live");
  });

  it("shows Live's latest content for a block the draft doesn't change", async () => {
    const { ctx, openDraft, create, titleIn } = await fixture("draft-untouched");
    const block = await create("Live");
    const draft = await openDraft();

    await runService(updateBlockContent(ctx, { id: block.id, content: { title: "Later" } }, null));

    expect(await titleIn(block.id, draft)).toBe("Later");
  });

  it("keeps settings changed in a draft out of Live", async () => {
    const { ctx, openDraft, create } = await fixture("draft-settings");
    const block = await create("Live");
    const draft = await openDraft();

    await runService(updateBlockSettings(ctx, { id: block.id, settings: { dark: true } }, draft));

    const settingsIn = async (scope: DraftScope) =>
      (await runService(getBlock(ctx, { id: block.id }, scope))).block.settings;
    expect(await settingsIn(draft)).toEqual({ dark: true });
    expect(await settingsIn(null)).toEqual({ dark: false });
  });

  it("hides a block deleted in a draft in that draft only", async () => {
    const { ctx, openDraft, create, pageTitles } = await fixture("draft-delete");
    const first = await create("First");
    await create("Second");
    const draft = await openDraft();

    await runService(deleteBlock(ctx, { id: first.id }, draft));

    expect(await pageTitles(draft)).toEqual(["<!-- Hero -->\n# Second"]);
    expect(await pageTitles(null)).toEqual(["<!-- Hero -->\n# First", "<!-- Hero -->\n# Second"]);
    await expect(runService(getBlock(ctx, { id: first.id }, draft))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deletes several blocks in a draft only", async () => {
    const { ctx, openDraft, create, pageTitles } = await fixture("draft-delete-many");
    const first = await create("First");
    const second = await create("Second");
    const draft = await openDraft();

    await runService(deleteBlocks(ctx, { blockIds: [first.id, second.id] }, draft));

    expect(await pageTitles(draft)).toEqual([]);
    expect(await pageTitles(null)).toHaveLength(2);
  });

  it("creates a block in a draft only", async () => {
    const { openDraft, create, pageTitles } = await fixture("draft-create");
    await create("Live");
    const draft = await openDraft();

    await create("Draft", draft);

    expect(await pageTitles(draft)).toEqual(["<!-- Hero -->\n# Live", "<!-- Hero -->\n# Draft"]);
    expect(await pageTitles(null)).toEqual(["<!-- Hero -->\n# Live"]);
  });

  it("rejects creating a block with an id the draft already reads from Live", async () => {
    const { ctx, page, openDraft, create } = await fixture("draft-create-conflict");
    const block = await create("Live");
    const draft = await openDraft();

    await expect(
      runService(
        createBlock(ctx, { id: block.id, pageId: page.id, type: "hero", content: {} }, draft),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("moves a block in a draft only, carrying the content it had when moved", async () => {
    const { ctx, openDraft, create, pageTitles } = await fixture("draft-move");
    const first = await create("First");
    const second = await create("Second");
    const draft = await openDraft();

    await runService(
      updateBlockPosition(ctx, { id: first.id, afterPosition: second.position }, draft),
    );
    await runService(updateBlockContent(ctx, { id: first.id, content: { title: "Live" } }, null));

    expect(await pageTitles(draft)).toEqual(["<!-- Hero -->\n# Second", "<!-- Hero -->\n# First"]);
    expect(await pageTitles(null)).toEqual(["<!-- Hero -->\n# Live", "<!-- Hero -->\n# Second"]);
  });

  it("duplicates a block in a draft only", async () => {
    const { ctx, openDraft, create, pageTitles } = await fixture("draft-duplicate");
    const block = await create("Live");
    const draft = await openDraft();

    await runService(duplicateBlock(ctx, { id: block.id }, draft));

    expect(await pageTitles(draft)).toEqual(["<!-- Hero -->\n# Live", "<!-- Hero -->\n# Live"]);
    expect(await pageTitles(null)).toHaveLength(1);
  });

  it("serves a page with the draft's blocks in the draft only", async () => {
    const { ctx, project, openDraft, create } = await fixture("draft-page");
    const block = await create("Live");
    const draft = await openDraft();
    await runService(updateBlockContent(ctx, { id: block.id, content: { title: "Draft" } }, draft));

    const titlesOnPage = async (scope: DraftScope) =>
      (
        await runService(getPageByPath(ctx, { projectSlug: project.slug, path: "/" }, scope))
      ).blocks.map((shown) => (shown.content as { title: string }).title);
    expect(await titlesOnPage(draft)).toEqual(["Draft"]);
    expect(await titlesOnPage(null)).toEqual(["Live"]);
  });

  it("leaves the Live page untouched by draft writes", async () => {
    const { ctx, db, page, openDraft, create } = await fixture("draft-page-untouched");
    const block = await create("Live");
    const before = await db.select().from(pages).where(eq(pages.id, page.id)).get();
    const draft = await openDraft();

    await runService(updateBlockContent(ctx, { id: block.id, content: { title: "Draft" } }, draft));
    await create("Draft", draft);
    await runService(deleteBlock(ctx, { id: block.id }, draft));

    const after = await db.select().from(pages).where(eq(pages.id, page.id)).get();
    expect(after?.contentUpdatedAt).toBe(before?.contentUpdatedAt);
  });

  it("seeds a block's default repeatable items in the draft only, leaving none on Live once discarded", async () => {
    const { ctx, db, page, project, openDraft } = await fixture("draft-create-items");
    await runService(
      upsertBlockDefinition(createServiceContext(db, null), {
        projectSlug: project.slug,
        deployToken: project.deployToken,
        blockId: "list",
        title: "List",
        description: "List",
        contentSchema: {
          type: "object",
          properties: {
            items: {
              fieldType: "Repeater",
              minItems: 2,
              items: { properties: { title: { default: "Item" } } },
            },
          },
        },
      }),
    );
    const draft = await openDraft();

    const block = await runService(
      createBlock(ctx, { pageId: page.id, type: "list", content: {} }, draft),
    );

    const itemsOf = (scope: DraftScope) =>
      db
        .select()
        .from(repeatableItems)
        .where(
          and(
            eq(repeatableItems.blockId, block.id),
            scope ? eq(repeatableItems.draftId, scope.id) : isNull(repeatableItems.draftId),
          ),
        );
    expect(await itemsOf(draft)).toHaveLength(2);
    expect(await itemsOf(null)).toEqual([]);

    await runService(
      discardDraft(
        { ...ctx, draft: { id: draft!.id, create: false } },
        {
          projectId: project.id,
        },
      ),
    );

    expect(
      await db.select().from(repeatableItems).where(eq(repeatableItems.blockId, block.id)),
    ).toEqual([]);
  });

  it("finds no block that only another draft created", async () => {
    const { ctx, openDraft, create } = await fixture("draft-other");
    const draft = await openDraft();
    const other = await openDraft();
    const block = await create("Draft", draft);

    await expect(runService(getBlock(ctx, { id: block.id }, other))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      runService(updateBlockContent(ctx, { id: generateUuidv7(), content: {} }, draft)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
