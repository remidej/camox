import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";

import {
  createProjectFixture,
  createRpcContext,
  createServiceContext,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { layouts } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";

const { broadcastInvalidation, broadcastDraftEnded } = vi.hoisted(() => {
  // Modules loaded by earlier test files would keep the real broadcaster.
  vi.resetModules();
  return { broadcastInvalidation: vi.fn(), broadcastDraftEnded: vi.fn() };
});
vi.mock("../../lib/broadcast-invalidation", () => ({ broadcastInvalidation, broadcastDraftEnded }));

type Headers = Record<string, string>;
/** Headers naming a draft, creating it when missing. */
const startingDraft = (id: string) => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
/** Headers naming an existing draft. */
const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });

async function fixture() {
  const base = await createProjectFixture(`page-drafts-${crypto.randomUUID()}`);
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      blockId: "hero",
      title: "Hero",
      description: "Hero",
      contentSchema: {
        type: "object",
        properties: {
          title: { fieldType: "String", type: "string" },
          links: {
            fieldType: "Repeater",
            type: "array",
            items: {
              type: "object",
              properties: { label: { fieldType: "String", type: "string" } },
            },
          },
        },
        toMarkdown: ["# {{title}}"],
      },
    }),
  );
  const projectId = base.project.id;
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(base.db, base.memberUser, headers),
  });

  const createPage = (
    pathSegment: string,
    headers: Headers = {},
    { parentPageId }: { parentPageId?: string } = {},
  ) =>
    call(
      router.pages.create,
      { projectId, pathSegment, parentPageId, layoutId: base.layout.layoutId },
      member(headers),
    ).then(({ page }) => page);
  const updatePage = (
    input: { id: string; nickname?: string; pathSegment?: string; parentPageId?: string | null },
    headers: Headers = {},
  ) => call(router.pages.update, input, member(headers));
  const deletePage = (id: string, headers: Headers = {}) =>
    call(router.pages.delete, { id }, member(headers));
  const paths = async (headers: Headers = {}) =>
    (await call(router.pages.list, { projectId }, member(headers)))
      .map((page) => page.fullPath)
      .sort();
  const getPage = (id: string, headers: Headers = {}) =>
    call(router.pages.get, { id }, member(headers));
  const pageAt = (path: string, headers: Headers = {}) =>
    call(router.pages.getByPath, { projectSlug: base.project.slug, path }, member(headers));

  const createBlock = (pageId: string, title: string, headers: Headers = {}) =>
    call(router.blocks.create, { pageId, type: "hero", content: { title } }, member(headers));
  const createItem = (blockId: string, label: string, headers: Headers = {}) =>
    call(
      router.repeatableItems.create,
      { blockId, fieldName: "links", content: { label } },
      member(headers),
    );

  const preview = (draftId: string) =>
    call(router.drafts.previewPublish, { projectId }, member(inDraft(draftId)));
  const publish = async (draftId: string) =>
    call(
      router.drafts.publish,
      { projectId, token: (await preview(draftId)).token },
      member(inDraft(draftId)),
    );
  /** Changes Live the way it changes in v1: by publishing another draft. */
  const publishedOnLive = async (change: (headers: Headers) => Promise<unknown>) => {
    const other = generateUuidv7();
    await change(startingDraft(other));
    await publish(other);
  };

  return {
    ...base,
    member,
    createPage,
    updatePage,
    deletePage,
    paths,
    getPage,
    pageAt,
    createBlock,
    createItem,
    preview,
    publish,
    publishedOnLive,
  };
}

describe("pages in a draft", () => {
  it("creates a page in the draft that Live doesn't show until the draft is published", async () => {
    const { createPage, pageAt, paths, publish } = await fixture();
    const draft = generateUuidv7();

    await createPage("pricing", startingDraft(draft));

    expect(await paths(inDraft(draft))).toEqual(["/pricing"]);
    expect(await paths()).toEqual([]);
    await expect(pageAt("/pricing")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await pageAt("/pricing", inDraft(draft))).page.fullPath).toBe("/pricing");

    await publish(draft);
    expect(await paths()).toEqual(["/pricing"]);
  });

  it("copies every descendant whose full path changes when a parent page is renamed, and publishing applies them all", async () => {
    const { createPage, paths, preview, publish, updatePage } = await fixture();
    const docs = await createPage("docs");
    const guide = await createPage("guide", {}, { parentPageId: docs.id });
    await createPage("setup", {}, { parentPageId: guide.id });
    await createPage("blog");
    const draft = generateUuidv7();

    await updatePage({ id: docs.id, pathSegment: "manual" }, startingDraft(draft));

    expect(await paths(inDraft(draft))).toEqual([
      "/blog",
      "/manual",
      "/manual/guide",
      "/manual/guide/setup",
    ]);
    expect(await paths()).toEqual(["/blog", "/docs", "/docs/guide", "/docs/guide/setup"]);
    expect((await preview(draft)).changes).toHaveLength(3);

    await publish(draft);
    expect(await paths()).toEqual(["/blog", "/manual", "/manual/guide", "/manual/guide/setup"]);
  });

  it("moves a page under another parent in the draft only", async () => {
    const { createPage, paths, publish, updatePage } = await fixture();
    const docs = await createPage("docs");
    const faq = await createPage("faq");
    const draft = generateUuidv7();

    await updatePage({ id: faq.id, parentPageId: docs.id }, startingDraft(draft));

    expect(await paths(inDraft(draft))).toEqual(["/docs", "/docs/faq"]);
    expect(await paths()).toEqual(["/docs", "/faq"]);
    await publish(draft);
    expect(await paths()).toEqual(["/docs", "/docs/faq"]);
  });

  it("changes a page's nickname, layout and SEO in the draft only", async () => {
    const { createPage, db, environment, getPage, member, project, publish, updatePage } =
      await fixture();
    const now = Date.now();
    await db.insert(layouts).values({
      projectId: project.id,
      environmentId: environment.id,
      layoutId: "landing",
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const page = await createPage("about");
    const draft = generateUuidv7();

    await updatePage({ id: page.id, nickname: "Who we are" }, startingDraft(draft));
    await call(
      router.pages.setLayout,
      { id: page.id, layoutId: "landing" },
      member(inDraft(draft)),
    );
    await call(router.pages.setSeo, { id: page.id, metaTitle: "About us" }, member(inDraft(draft)));

    expect(await getPage(page.id, inDraft(draft))).toMatchObject({
      nickname: "Who we are",
      layoutId: "landing",
      metaTitle: "About us",
    });
    expect(await getPage(page.id)).toMatchObject({
      nickname: "About",
      layoutId: "default",
      metaTitle: null,
    });

    await publish(draft);
    expect(await getPage(page.id)).toMatchObject({
      nickname: "Who we are",
      layoutId: "landing",
      metaTitle: "About us",
    });
  });

  it("deletes a page in the draft only, and publishing removes it from Live with its descendants, blocks and repeatable items", async () => {
    const { createBlock, createItem, createPage, deletePage, member, pageAt, paths, publish } =
      await fixture();
    const docs = await createPage("docs");
    await createPage("guide", {}, { parentPageId: docs.id });
    const block = await createBlock(docs.id, "Docs");
    const item = await createItem(block.id, "Link");
    const draft = generateUuidv7();

    await deletePage(docs.id, startingDraft(draft));

    expect(await paths(inDraft(draft))).toEqual(["/docs/guide"]);
    expect(await paths()).toEqual(["/docs", "/docs/guide"]);
    expect((await pageAt("/docs")).page.blockIds).toEqual([block.id]);

    await publish(draft);
    expect(await paths()).toEqual([]);
    await expect(call(router.blocks.get, { id: block.id }, member())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(call(router.repeatableItems.get, { id: item.id }, member())).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
  });

  it("lists a page Live renamed after the draft changed it as a conflict, and overwrites it", async () => {
    const { createPage, getPage, preview, publish, publishedOnLive, updatePage } = await fixture();
    const page = await createPage("about");
    const draft = generateUuidv7();
    await updatePage({ id: page.id, nickname: "Mine" }, startingDraft(draft));
    await publishedOnLive((headers) => updatePage({ id: page.id, nickname: "Theirs" }, headers));

    expect((await preview(draft)).conflicts).toEqual([
      expect.objectContaining({ entity: "page", id: page.id }),
    ]);
    await publish(draft);
    expect((await getPage(page.id)).nickname).toBe("Mine");
  });

  it("lists a page whose parent exists neither in Live nor in the draft as lost", async () => {
    const { createPage, deletePage, paths, preview, publish, publishedOnLive } = await fixture();
    const docs = await createPage("docs");
    const draft = generateUuidv7();
    const child = await createPage("guide", startingDraft(draft), { parentPageId: docs.id });
    await publishedOnLive((headers) => deletePage(docs.id, headers));

    expect((await preview(draft)).lost).toEqual([
      expect.objectContaining({ entity: "page", id: child.id, reason: "parentGone" }),
    ]);
    await publish(draft);
    expect(await paths()).toEqual([]);
  });
});
