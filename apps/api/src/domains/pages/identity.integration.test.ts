import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { describe, expect, it, vi } from "vitest";

import {
  createProjectFixture,
  createServiceContext,
  callSeedingLive,
} from "../../../test/fixtures";
import { lexicalStateToMarkdown, markdownToLexicalState } from "../../lib/lexical-state";
import { runService } from "../../lib/run-service";
import type { BaseContext } from "../../orpc";
import { blockDefinitions, environments, layouts } from "../../schema";
import { callTool } from "../agent/service";
import { upsertBlockDefinition } from "../block-definitions/service";
import { blockProcedures as blockRoutes } from "../blocks/routes";
import { commentProcedures as commentRoutes } from "../comments/routes";
import { replicateEnvironment } from "../environments/service";
import { repeatableItemProcedures as itemRoutes } from "../repeatable-items/routes";
import { pageProcedures as pageRoutes } from "./routes";

const { broadcastInvalidation } = vi.hoisted(() => {
  vi.resetModules();
  return { broadcastInvalidation: vi.fn() };
});
vi.mock("../../lib/broadcast-invalidation", () => ({ broadcastInvalidation }));

// Independent of the shared schema: version nibble 7, RFC 4122 variant.
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CLIENT_PAGE_ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b";
const CLIENT_BLOCK_ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7c";
const CLIENT_ITEM_ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7d";
const NOT_UUIDV7 = [1, "1", "2b0f6c2e-4a1d-4c6e-9b8a-3f2e1d0c9b8a"] as const;

async function fixture() {
  const base = await createProjectFixture(`page-identity-${crypto.randomUUID()}`);
  const ctx = createServiceContext(base.db, base.memberUser);
  const context: BaseContext = {
    ...ctx,
    headers: new Headers(),
    session: {
      id: "session",
      token: "test",
      userId: base.memberUser.id,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      blockId: "list",
      title: "List",
      description: "A titled list",
      contentSchema: {
        type: "object",
        toMarkdown: ["{{cta}}"],
        properties: {
          body: { type: "string", fieldType: "String" },
          cta: {
            type: "object",
            fieldType: "Link",
            properties: {
              type: { type: "string", enum: ["external", "page"] },
              text: { type: "string" },
              href: { type: "string" },
              pageId: { type: "string" },
              newTab: { type: "boolean" },
            },
          },
          entries: {
            type: "array",
            fieldType: "Repeater",
            items: {
              type: "object",
              properties: { title: { type: "string", default: "Entry" } },
            },
          },
        },
      },
    }),
  );
  const options = { context };
  const { page } = await callSeedingLive(
    pageRoutes.create,
    { projectId: base.project.id, pathSegment: "about", layoutId: base.layout.layoutId },
    options,
  );
  // AI tools write content, so they run in a draft: Live is read-only.
  const draftId = generateUuidv7();
  const toolCtx = { ...ctx, draft: { id: draftId, create: true } };
  const inDraft = { context: { ...context, headers: new Headers({ [DRAFT_HEADER]: draftId }) } };
  return { ...base, ctx, options, page, toolCtx, inDraft };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

const createBlock = (f: Fixture, input: Record<string, unknown> = {}) =>
  callSeedingLive(
    blockRoutes.create,
    { pageId: f.page.id, type: "list", content: { entries: [] }, ...input } as never,
    f.options,
  );

const createItem = (f: Fixture, blockId: string, input: Record<string, unknown> = {}) =>
  callSeedingLive(
    itemRoutes.create,
    { blockId, fieldName: "entries", content: { title: "Entry" }, ...input } as never,
    f.options,
  );

const tool = (f: Fixture, name: string, args: Record<string, unknown>) =>
  runService(callTool(f.toolCtx, { projectId: f.project.id, name, arguments: args }));

describe("stable page tree identity", () => {
  it("creating a page, block or repeatable item returns a UUIDv7", async () => {
    const f = await fixture();
    expect(f.page.id).toMatch(UUIDV7);
    const block = await createBlock(f);
    expect(block.id).toMatch(UUIDV7);
    const item = await createItem(f, block.id);
    expect(item.id).toMatch(UUIDV7);

    const created = await tool(f, "createPage", {
      pathSegment: "pricing",
      layoutId: f.layout.layoutId,
    });
    expect(created).toMatchObject({
      ok: true,
      result: { page: { id: expect.stringMatching(UUIDV7) } },
    });
  });

  it("keeps a client-minted UUIDv7 for a page, block or repeatable item", async () => {
    const f = await fixture();
    const { page } = await callSeedingLive(
      pageRoutes.create,
      {
        id: CLIENT_PAGE_ID,
        projectId: f.project.id,
        pathSegment: "contact",
        layoutId: f.layout.layoutId,
      },
      f.options,
    );
    expect(page.id).toBe(CLIENT_PAGE_ID);
    const block = await createBlock(f, { id: CLIENT_BLOCK_ID, pageId: CLIENT_PAGE_ID });
    expect(block.id).toBe(CLIENT_BLOCK_ID);
    const item = await createItem(f, CLIENT_BLOCK_ID, { id: CLIENT_ITEM_ID });
    expect(item.id).toBe(CLIENT_ITEM_ID);

    expect(await callSeedingLive(pageRoutes.get, { id: CLIENT_PAGE_ID }, f.options)).toMatchObject({
      id: CLIENT_PAGE_ID,
    });
    expect(
      await callSeedingLive(blockRoutes.get, { id: CLIENT_BLOCK_ID }, f.options),
    ).toMatchObject({
      block: { id: CLIENT_BLOCK_ID, pageId: CLIENT_PAGE_ID },
      repeatableItems: [{ id: CLIENT_ITEM_ID, blockId: CLIENT_BLOCK_ID }],
    });

    // An id is never reused: minting one that already exists is a conflict, not an overwrite.
    await expect(createBlock(f, { id: CLIENT_BLOCK_ID })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("procedures and AI tools reject a page, block or item id that isn't a UUIDv7", async () => {
    const f = await fixture();
    const block = await createBlock(f);
    const item = await createItem(f, block.id);
    const page = { projectId: f.project.id, pathSegment: "x", layoutId: f.layout.layoutId };
    for (const id of NOT_UUIDV7) {
      for (const [procedure, input] of [
        [pageRoutes.create, { ...page, id }],
        [pageRoutes.create, { ...page, parentPageId: id }],
        [pageRoutes.get, { id }],
        [pageRoutes.update, { id, nickname: "Renamed" }],
        [pageRoutes.delete, { id }],
        [blockRoutes.create, { id, pageId: f.page.id, type: "list", content: {} }],
        [blockRoutes.create, { pageId: id, type: "list", content: {} }],
        [blockRoutes.get, { id }],
        [blockRoutes.getPageMarkdown, { pageId: id }],
        [blockRoutes.updateContent, { id, content: {} }],
        [blockRoutes.delete, { id }],
        [blockRoutes.deleteMany, { blockIds: [id] }],
        [itemRoutes.create, { id, blockId: block.id, fieldName: "entries", content: {} }],
        [itemRoutes.create, { blockId: id, fieldName: "entries", content: {} }],
        [itemRoutes.get, { id }],
        [itemRoutes.updateContent, { id, content: {} }],
        [itemRoutes.delete, { id }],
        [commentRoutes.list, { pageId: id }],
        [
          commentRoutes.create,
          { pageId: f.page.id, message: "Hi", target: { kind: "block", blockId: id } },
        ],
        [
          commentRoutes.create,
          {
            pageId: f.page.id,
            message: "Hi",
            target: { kind: "item", blockId: block.id, itemId: id },
          },
        ],
      ] as const) {
        await expect(
          callSeedingLive(procedure as never, input as never, f.options),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      }
      for (const [name, args] of [
        ["getPage", { id }],
        ["updatePage", { id, nickname: "Renamed" }],
        ["deletePage", { id }],
        ["getBlock", { id }],
        ["getBlocks", { ids: [id] }],
        ["createBlock", { pageId: id, type: "list", content: {} }],
        ["createBlock", { pageId: f.page.id, type: "list", content: {}, afterId: id }],
        ["editBlock", { id, content: {} }],
        ["moveBlock", { id, position: "first" }],
        ["deleteBlock", { id }],
        ["listComments", { pageId: id }],
      ] as const) {
        expect(await tool(f, name, args)).toMatchObject({ ok: false });
      }
    }
    expect(await callSeedingLive(blockRoutes.get, { id: block.id }, f.options)).toMatchObject({
      repeatableItems: [{ id: item.id }],
    });
  });

  it("`_itemId` patches address repeatable items by UUIDv7", async () => {
    const f = await fixture();
    const block = await createBlock(f);
    const first = await createItem(f, block.id, { content: { title: "First" } });
    const second = await createItem(f, block.id, {
      content: { title: "Second" },
      afterPosition: first.position,
    });

    const edited = await tool(f, "editBlock", {
      id: block.id,
      content: { entries: [{ _itemId: second.id }, { _itemId: first.id, title: "Changed" }] },
    });
    expect(edited).toMatchObject({ ok: true });
    const { block: read, repeatableItems } = await callSeedingLive(
      blockRoutes.get,
      { id: block.id },
      f.inDraft,
    );
    expect(read.content).toMatchObject({
      entries: [{ _itemId: second.id }, { _itemId: first.id }],
    });
    expect(repeatableItems.find((item) => item.id === first.id)?.content).toMatchObject({
      title: "Changed",
    });

    for (const _itemId of NOT_UUIDV7) {
      await expect(
        callSeedingLive(
          blockRoutes.updateContent,
          { id: block.id, content: { entries: [{ _itemId }] } },
          f.options,
        ),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("comments anchor to pages, blocks and repeatable items by UUIDv7", async () => {
    const f = await fixture();
    const block = await createBlock(f);
    const item = await createItem(f, block.id);
    const target = { kind: "item-field", blockId: block.id, itemId: item.id, fieldName: "title" };
    const comment = await callSeedingLive(
      commentRoutes.create,
      { pageId: f.page.id, message: "Typo", target } as never,
      f.options,
    );
    expect(comment).toMatchObject({ pageId: f.page.id, target });
    expect(
      await callSeedingLive(commentRoutes.list, { pageId: f.page.id }, f.options),
    ).toMatchObject([{ id: comment.id, target }]);
  });

  it("page links in text and link fields store the page's UUIDv7 and render as links", async () => {
    const f = await fixture();
    const link = { type: "page", text: "About us", pageId: f.page.id };
    const body = JSON.stringify(markdownToLexicalState(`[About](camox:page:${f.page.id})`));
    await createBlock(f, { content: { body, cta: link, entries: [] } });
    const markdown = await callSeedingLive(
      blockRoutes.getPageMarkdown,
      { pageId: f.page.id },
      f.options,
    );
    expect(markdown.markdown).toContain(`[About us](camox:page:${f.page.id})`);

    const target = await f.db
      .insert(environments)
      .values({
        projectId: f.project.id,
        name: "target",
        type: "development",
        createdAt: 1,
        updatedAt: 1,
      })
      .returning()
      .get();
    await f.db.insert(layouts).values({ ...f.layout, rowId: undefined, environmentId: target.id });
    for (const definition of await f.db.select().from(blockDefinitions)) {
      if (definition.environmentId !== f.environment.id) continue;
      await f.db
        .insert(blockDefinitions)
        .values({ ...definition, rowId: undefined, environmentId: target.id });
    }
    await runService(
      replicateEnvironment(f.ctx, {
        projectId: f.project.id,
        sourceEnvName: "production",
        targetEnvName: "target",
      }),
    );
    const replicaCtx = {
      ...f.options,
      context: { ...f.options.context, environmentName: "target" },
    };
    const [replica] = await callSeedingLive(
      pageRoutes.list,
      { projectId: f.project.id },
      replicaCtx,
    );
    expect(replica!.id).toMatch(UUIDV7);
    const replicaMarkdown = await callSeedingLive(
      blockRoutes.getPageMarkdown,
      { pageId: replica!.id },
      replicaCtx,
    );
    expect(replicaMarkdown.markdown).toContain(`[About us](camox:page:${replica!.id})`);
    const { block: replicaBlock } = await callSeedingLive(
      blockRoutes.get,
      { id: replicaMarkdown.blocks[0]!.id },
      replicaCtx,
    );
    expect(lexicalStateToMarkdown((replicaBlock.content as { body: string }).body)).toBe(
      `[About](camox:page:${replica!.id})`,
    );
  });

  it("rejects page links in text and link fields that don't store a UUIDv7", async () => {
    const f = await fixture();
    const block = await createBlock(f);
    for (const pageId of NOT_UUIDV7) {
      const contents = [
        { body: JSON.stringify(markdownToLexicalState(`[About](camox:page:${pageId})`)) },
        { cta: { type: "page", text: "About us", pageId } },
      ];
      for (const content of contents) {
        await expect(
          createBlock(f, { content: { ...content, entries: [] } }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        await expect(
          callSeedingLive(blockRoutes.updateContent, { id: block.id, content }, f.options),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
    }
  });
});
