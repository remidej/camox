import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  createProjectFixture,
  createRpcContext,
  createServiceContext,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { blocks, pages } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";

const { broadcastInvalidation } = vi.hoisted(() => ({ broadcastInvalidation: vi.fn() }));
vi.mock("../../lib/broadcast-invalidation", () => ({ broadcastInvalidation }));

type Caller = "member" | "outsider" | "anonymous";

/** Headers naming a draft, creating it when missing. */
const startingDraft = (id: string) => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
/** Headers naming an existing draft. */
const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });

async function fixture() {
  const base = await createProjectFixture(`draft-requests-${crypto.randomUUID()}`);
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
  const now = 1_700_000_000_000;
  const page = await base.db
    .insert(pages)
    .values({
      projectId: base.project.id,
      environmentId: base.environment.id,
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

  const users = { member: base.memberUser, outsider: base.outsiderUser, anonymous: null };
  const as = (caller: Caller, headers: Record<string, string> = {}) => ({
    context: createRpcContext(base.db, users[caller], headers),
  });
  const member = (headers: Record<string, string> = {}) => as("member", headers);

  const createBlock = (title: string, headers: Record<string, string> = {}) =>
    call(
      router.blocks.create,
      { pageId: page.id, type: "hero", content: { title } },
      member(headers),
    );
  const editTitle = (id: string, title: string, headers: Record<string, string> = {}) =>
    call(router.blocks.updateContent, { id, content: { title } }, member(headers));
  const titleIn = async (id: string, headers: Record<string, string> = {}) =>
    (await call(router.blocks.get, { id }, member(headers))).block.content.title;
  const pageBlockIds = async (headers: Record<string, string> = {}) =>
    (
      await call(
        router.pages.getStructure,
        { projectSlug: base.project.slug, path: "/" },
        member(headers),
      )
    ).page.blockIds;

  return { ...base, page, as, member, createBlock, editTitle, titleIn, pageBlockIds };
}

describe("block procedures in the draft a request names", () => {
  it("reads a block edited in a draft as changed there, and unchanged on Live and in another draft", async () => {
    const { createBlock, editTitle, titleIn } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    const other = generateUuidv7();

    await editTitle(block.id, "Draft", startingDraft(draft));
    await editTitle(block.id, "Other", startingDraft(other));
    await editTitle(block.id, "Other again", inDraft(other));

    expect(await titleIn(block.id, inDraft(draft))).toBe("Draft");
    expect(await titleIn(block.id)).toBe("Live");
    expect(await titleIn(block.id, inDraft(other))).toBe("Other again");
  });

  it("shows Live's latest content for a block the draft doesn't change", async () => {
    const { createBlock, editTitle, titleIn } = await fixture();
    const changed = await createBlock("Changed");
    const untouched = await createBlock("Before");
    const draft = generateUuidv7();
    await editTitle(changed.id, "Draft", startingDraft(draft));

    await editTitle(untouched.id, "After");

    expect(await titleIn(untouched.id, inDraft(draft))).toBe("After");
  });

  it("hides a block deleted in a draft in that draft only", async () => {
    const { member, createBlock, pageBlockIds } = await fixture();
    const kept = await createBlock("Kept");
    const deleted = await createBlock("Deleted");
    const draft = generateUuidv7();

    await call(router.blocks.delete, { id: deleted.id }, member(startingDraft(draft)));

    expect(await pageBlockIds(inDraft(draft))).toEqual([kept.id]);
    expect(await pageBlockIds()).toEqual([kept.id, deleted.id]);
  });

  it("records the Live version the first write in a draft copied", async () => {
    const { db, createBlock, editTitle } = await fixture();
    const block = await createBlock("One");
    await editTitle(block.id, "Two");
    const draft = generateUuidv7();

    await editTitle(block.id, "Draft", startingDraft(draft));
    await editTitle(block.id, "Live again");
    await editTitle(block.id, "Draft again", inDraft(draft));

    // No procedure exposes versions until publish (#236), so the draft's row is read directly.
    const copy = await db
      .select({ baseVersion: blocks.baseVersion })
      .from(blocks)
      .where(and(eq(blocks.id, block.id), eq(blocks.draftId, draft)))
      .get();
    expect(copy).toEqual({ baseVersion: 2 });
  });

  it("starts one draft when two writes send the same new draft id with the create header", async () => {
    const { createBlock, editTitle, titleIn } = await fixture();
    const first = await createBlock("First");
    const second = await createBlock("Second");
    const draft = generateUuidv7();

    await Promise.all([
      editTitle(first.id, "First in draft", startingDraft(draft)),
      editTitle(second.id, "Second in draft", startingDraft(draft)),
    ]);

    expect(await titleIn(first.id, inDraft(draft))).toBe("First in draft");
    expect(await titleIn(second.id, inDraft(draft))).toBe("Second in draft");
  });

  it("leaves no draft behind when the write starting it fails", async () => {
    const { member, page, createBlock, titleIn } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();

    await expect(
      call(
        router.blocks.create,
        { pageId: page.id, type: "hero", content: {}, afterPosition: "a", beforePosition: "b" },
        member(startingDraft(draft)),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(titleIn(block.id, inDraft(draft))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects writing to a missing draft without the create header", async () => {
    const { createBlock, editTitle, titleIn } = await fixture();
    const block = await createBlock("Live");

    await expect(editTitle(block.id, "Lost", inDraft(generateUuidv7()))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await titleIn(block.id)).toBe("Live");
  });

  it("rejects an outsider with 403 and an anonymous caller with 401", async () => {
    const { as, createBlock, editTitle, page } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Draft", startingDraft(draft));

    for (const headers of [inDraft(draft), startingDraft(generateUuidv7())]) {
      const edit = (caller: Caller) =>
        call(
          router.blocks.updateContent,
          { id: block.id, content: { title: "x" } },
          as(caller, headers),
        );
      const read = (caller: Caller) =>
        call(router.blocks.get, { id: block.id }, as(caller, headers));
      const structure = (caller: Caller) =>
        call(router.blocks.getPageMarkdown, { pageId: page.id }, as(caller, headers));

      await expect(edit("outsider")).rejects.toMatchObject({ status: 403 });
      await expect(edit("anonymous")).rejects.toMatchObject({ status: 401 });
      await expect(read("outsider")).rejects.toMatchObject({ status: 403 });
      await expect(read("anonymous")).rejects.toMatchObject({ status: 401 });
      await expect(structure("anonymous")).rejects.toMatchObject({ status: 401 });
    }
  });

  it("edits, moves and deletes a block the draft created", async () => {
    const { member, createBlock, editTitle, titleIn, pageBlockIds } = await fixture();
    const live = await createBlock("Live");
    const draft = generateUuidv7();
    const created = await createBlock("Created", startingDraft(draft));

    await editTitle(created.id, "Edited", inDraft(draft));
    await call(
      router.blocks.updatePosition,
      { id: created.id, beforePosition: live.position },
      member(inDraft(draft)),
    );

    expect(await titleIn(created.id, inDraft(draft))).toBe("Edited");
    expect(await pageBlockIds(inDraft(draft))).toEqual([created.id, live.id]);
    expect(await pageBlockIds()).toEqual([live.id]);
    await expect(titleIn(created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await call(router.blocks.delete, { id: created.id }, member(inDraft(draft)));
    expect(await pageBlockIds(inDraft(draft))).toEqual([live.id]);
  });

  it("serves the draft's blocks in page and Markdown reads", async () => {
    const { member, page, project, createBlock, editTitle } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Draft", startingDraft(draft));

    const titles = async (headers: Record<string, string>) => ({
      byPath: (
        await call(
          router.pages.getByPath,
          { projectSlug: project.slug, path: "/" },
          member(headers),
        )
      ).blocks.map((shown) => shown.content.title),
      markdown: (
        await call(router.blocks.getPageMarkdown, { pageId: page.id }, member(headers))
      ).blocks.map((shown) => shown.markdown.includes("# Draft")),
    });

    expect(await titles(inDraft(draft))).toEqual({ byPath: ["Draft"], markdown: [true] });
    expect(await titles({})).toEqual({ byPath: ["Live"], markdown: [false] });
  });

  it("adds a repeatable item to a block the draft created", async () => {
    const { member, createBlock } = await fixture();
    const draft = generateUuidv7();
    const created = await createBlock("Created", startingDraft(draft));

    const item = await call(
      router.repeatableItems.create,
      { blockId: created.id, fieldName: "links", content: { label: "Docs" } },
      member(inDraft(draft)),
    );

    const shown = await call(router.blocks.get, { id: created.id }, member(inDraft(draft)));
    expect(shown.repeatableItems.map((shownItem) => shownItem.id)).toEqual([item.id]);
  });

  it("serves other content from Live to requests naming a draft", async () => {
    const { member, project, createBlock } = await fixture();
    await createBlock("Live");
    const draft = generateUuidv7();

    const created = await call(
      router.pages.create,
      { projectId: project.id, pathSegment: "about", layoutId: "default" },
      member(startingDraft(draft)),
    );
    const listed = await call(router.pages.list, { projectId: project.id }, member(inDraft(draft)));

    expect(listed.map((listedPage) => listedPage.id)).toContain(created.page.id);
    const live = await call(router.pages.list, { projectId: project.id }, member());
    expect(live.map((listedPage) => listedPage.id)).toContain(created.page.id);
  });
});
