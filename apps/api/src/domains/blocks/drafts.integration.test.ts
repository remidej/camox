import { generateUuidv7 } from "@camox/api-contract/ids";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import {
  createProjectFixture,
  createServiceContext,
  seedLiveThrough,
  inScope,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { drafts, pages, repeatableItems } from "../../schema";
import { deleteDraft } from "../drafts/publish";
import type { Draft, DraftScope } from "../drafts/scope";
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

const hero = {
  blockId: "hero",
  title: "Hero",
  description: "Hero",
  contentSchema: {
    type: "object",
    properties: { title: { fieldType: "String", type: "string" } },
    toMarkdown: ["# {{title}}"],
  },
  settingsSchema: { properties: { dark: { type: "boolean", default: false } } },
};

async function fixture(suffix: string) {
  const base = await createProjectFixture(suffix);
  const ctx = createServiceContext(base.db, base.memberUser);
  await syncDefinitionSet(base.db, base.project, { blocks: [hero] });
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
  const openDraft = async (): Promise<Draft> => {
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
  /** Creates a block in a draft, or on Live through a published draft. */
  const create = (title: string, scope: DraftScope = null) => {
    const write = (draft: Draft) =>
      createBlock(inScope(ctx, draft), { pageId: page.id, type: "hero", content: { title } });
    return scope ? runService(write(scope)) : seedLiveThrough(ctx, base.project.id, write);
  };
  const titleIn = async (id: string, scope: DraftScope) =>
    (await runService(getBlock(inScope(ctx, scope), { id }))).block.content.title;
  const pageTitles = async (scope: DraftScope) =>
    (await runService(getPageMarkdown(inScope(ctx, scope), { pageId: page.id }))).blocks.map(
      (block) => block.markdown,
    );
  /** Changes a block's title on Live, through a published draft. */
  const editOnLive = (id: string, title: string) =>
    seedLiveThrough(ctx, base.project.id, (draft) =>
      updateBlockContent(inScope(ctx, draft), { id, content: { title } }),
    );
  return { ...base, ctx, page, openDraft, create, editOnLive, titleIn, pageTitles };
}

describe("blocks in a draft", () => {
  it("shows Live's latest content for a block the draft doesn't change", async () => {
    const { openDraft, create, editOnLive, titleIn } = await fixture("draft-untouched");
    const block = await create("Live");
    const draft = await openDraft();

    await editOnLive(block.id, "Later");

    expect(await titleIn(block.id, draft)).toBe("Later");
  });

  it("keeps settings changed in a draft out of Live", async () => {
    const { ctx, openDraft, create } = await fixture("draft-settings");
    const block = await create("Live");
    const draft = await openDraft();

    await runService(
      updateBlockSettings(inScope(ctx, draft), { id: block.id, settings: { dark: true } }),
    );

    const settingsIn = async (scope: DraftScope) =>
      (await runService(getBlock(inScope(ctx, scope), { id: block.id }))).block.settings;
    expect(await settingsIn(draft)).toEqual({ dark: true });
    expect(await settingsIn(null)).toEqual({ dark: false });
  });

  it("hides a block deleted in a draft in that draft only", async () => {
    const { ctx, openDraft, create, pageTitles } = await fixture("draft-delete");
    const first = await create("First");
    await create("Second");
    const draft = await openDraft();

    await runService(deleteBlock(inScope(ctx, draft), { id: first.id }));

    expect(await pageTitles(draft)).toEqual(["<!-- Hero -->\n# Second"]);
    expect(await pageTitles(null)).toEqual(["<!-- Hero -->\n# First", "<!-- Hero -->\n# Second"]);
    await expect(runService(getBlock(inScope(ctx, draft), { id: first.id }))).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
      },
    );
  });

  it("deletes several blocks in a draft only", async () => {
    const { ctx, openDraft, create, pageTitles } = await fixture("draft-delete-many");
    const first = await create("First");
    const second = await create("Second");
    const draft = await openDraft();

    await runService(deleteBlocks(inScope(ctx, draft), { blockIds: [first.id, second.id] }));

    expect(await pageTitles(draft)).toEqual([]);
    expect(await pageTitles(null)).toHaveLength(2);
  });

  it("rejects creating a block with an id the draft already reads from Live", async () => {
    const { ctx, page, openDraft, create } = await fixture("draft-create-conflict");
    const block = await create("Live");
    const draft = await openDraft();

    await expect(
      runService(
        createBlock(inScope(ctx, draft), {
          id: block.id,
          pageId: page.id,
          type: "hero",
          content: {},
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("moves a block in a draft only, carrying the content it had when moved", async () => {
    const { ctx, openDraft, create, editOnLive, pageTitles } = await fixture("draft-move");
    const first = await create("First");
    const second = await create("Second");
    const draft = await openDraft();

    await runService(
      updateBlockPosition(inScope(ctx, draft), { id: first.id, afterPosition: second.position }),
    );
    await editOnLive(first.id, "Live");

    expect(await pageTitles(draft)).toEqual(["<!-- Hero -->\n# Second", "<!-- Hero -->\n# First"]);
    expect(await pageTitles(null)).toEqual(["<!-- Hero -->\n# Live", "<!-- Hero -->\n# Second"]);
  });

  it("duplicates a block in a draft only", async () => {
    const { ctx, openDraft, create, pageTitles } = await fixture("draft-duplicate");
    const block = await create("Live");
    const draft = await openDraft();

    await runService(duplicateBlock(inScope(ctx, draft), { id: block.id }));

    expect(await pageTitles(draft)).toEqual(["<!-- Hero -->\n# Live", "<!-- Hero -->\n# Live"]);
    expect(await pageTitles(null)).toHaveLength(1);
  });

  it("leaves the Live page untouched by draft writes", async () => {
    const { ctx, db, page, openDraft, create } = await fixture("draft-page-untouched");
    const block = await create("Live");
    const before = await db.select().from(pages).where(eq(pages.id, page.id)).get();
    const draft = await openDraft();

    await runService(
      updateBlockContent(inScope(ctx, draft), { id: block.id, content: { title: "Draft" } }),
    );
    await create("Draft", draft);
    await runService(deleteBlock(inScope(ctx, draft), { id: block.id }));

    const after = await db.select().from(pages).where(eq(pages.id, page.id)).get();
    expect(after?.contentUpdatedAt).toBe(before?.contentUpdatedAt);
  });

  it("seeds a block's default repeatable items in the draft only, leaving none on Live once deleted", async () => {
    const { ctx, db, page, project, openDraft } = await fixture("draft-create-items");
    await syncDefinitionSet(db, project, {
      blocks: [
        hero,
        {
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
        },
      ],
    });
    const draft = await openDraft();

    const block = await runService(
      createBlock(inScope(ctx, draft), { pageId: page.id, type: "list", content: {} }),
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
      deleteDraft(
        { ...ctx, draft: { id: draft.id, create: false } },
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

    await expect(runService(getBlock(inScope(ctx, other), { id: block.id }))).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
      },
    );
    await expect(
      runService(updateBlockContent(inScope(ctx, draft), { id: generateUuidv7(), content: {} })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
