import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  callSeedingLive,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { pages } from "../../schema";
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
  const base = await createProjectFixture(`item-drafts-${crypto.randomUUID()}`);
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
              properties: {
                label: { fieldType: "String", type: "string" },
                children: {
                  fieldType: "Repeater",
                  type: "array",
                  items: {
                    type: "object",
                    properties: { label: { fieldType: "String", type: "string" } },
                  },
                },
              },
            },
          },
        },
        toMarkdown: ["# {{title}}"],
      },
    }),
  );
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
  const projectId = base.project.id;
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(base.db, base.memberUser, headers),
  });

  const createBlock = (title: string, headers: Headers = {}) =>
    callSeedingLive(
      router.blocks.create,
      { pageId: page.id, type: "hero", content: { title } },
      member(headers),
    );
  const deleteBlock = (id: string, headers: Headers = {}) =>
    callSeedingLive(router.blocks.delete, { id }, member(headers));
  const addItem = (
    blockId: string,
    label: string,
    headers: Headers = {},
    { parentItemId, fieldName = "links" }: { parentItemId?: string; fieldName?: string } = {},
  ) =>
    callSeedingLive(
      router.repeatableItems.create,
      { blockId, parentItemId, fieldName, content: { label } },
      member(headers),
    );
  const editItem = (id: string, label: string, headers: Headers = {}) =>
    callSeedingLive(
      router.repeatableItems.updateContent,
      { id, content: { label } },
      member(headers),
    );
  /** Moves an item before another position, or to the end. */
  const moveItem = (id: string, beforePosition: string | null, headers: Headers = {}) =>
    callSeedingLive(router.repeatableItems.updatePosition, { id, beforePosition }, member(headers));
  const deleteItem = (id: string, headers: Headers = {}) =>
    callSeedingLive(router.repeatableItems.delete, { id }, member(headers));
  const labelOf = async (id: string, headers: Headers = {}) =>
    (
      (await call(router.repeatableItems.get, { id }, member(headers))).item.content as {
        label: string;
      }
    ).label;
  /** The labels of a block's top-level links, in order, as a scope reads them. */
  const linksOf = async (blockId: string, headers: Headers = {}) => {
    const { block, repeatableItems } = await call(
      router.blocks.get,
      { id: blockId },
      member(headers),
    );
    const labels = new Map(
      repeatableItems.map((item) => [item.id, (item.content as { label: string }).label]),
    );
    // The block's content holds markers naming its items in order.
    return ((block.content as { links?: { _itemId: string }[] }).links ?? []).map((link) =>
      labels.get(link._itemId),
    );
  };

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
    page,
    member,
    createBlock,
    deleteBlock,
    addItem,
    editItem,
    moveItem,
    deleteItem,
    labelOf,
    linksOf,
    preview,
    publish,
    publishedOnLive,
  };
}

describe("repeatable items in a draft", () => {
  it("adds, edits, reorders and deletes items in the draft while Live keeps its items until publishing", async () => {
    const { addItem, createBlock, deleteItem, editItem, linksOf, moveItem, publish } =
      await fixture();
    const block = await createBlock("Hero");
    const first = await addItem(block.id, "First");
    const second = await addItem(block.id, "Second");
    const third = await addItem(block.id, "Third");
    const draft = generateUuidv7();

    await editItem(first.id, "First edited", startingDraft(draft));
    await moveItem(third.id, first.position, inDraft(draft));
    await deleteItem(second.id, inDraft(draft));
    await addItem(block.id, "Added", inDraft(draft));

    expect(await linksOf(block.id, inDraft(draft))).toEqual(["Third", "First edited", "Added"]);
    expect(await linksOf(block.id)).toEqual(["First", "Second", "Third"]);

    await publish(draft);
    expect(await linksOf(block.id)).toEqual(["Third", "First edited", "Added"]);
  });

  it("hides a deleted item's nested items in the draft, and publishing deletes them from Live", async () => {
    const { addItem, createBlock, deleteItem, labelOf, member, publish } = await fixture();
    const block = await createBlock("Hero");
    const parent = await addItem(block.id, "Parent");
    const child = await addItem(
      block.id,
      "Child",
      {},
      {
        parentItemId: parent.id,
        fieldName: "children",
      },
    );
    const draft = generateUuidv7();

    await deleteItem(parent.id, startingDraft(draft));

    await expect(
      call(router.repeatableItems.get, { id: child.id }, member(inDraft(draft))),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await labelOf(child.id)).toBe("Child");

    await publish(draft);
    await expect(
      call(router.repeatableItems.get, { id: child.id }, member()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("copies an item's content along when the draft only moves it, so Live's later edit is a conflict", async () => {
    const { addItem, createBlock, editItem, labelOf, moveItem, preview, publish, publishedOnLive } =
      await fixture();
    const block = await createBlock("Hero");
    const first = await addItem(block.id, "First");
    await addItem(block.id, "Second");
    const draft = generateUuidv7();
    await moveItem(first.id, null, startingDraft(draft));
    await publishedOnLive((headers) => editItem(first.id, "Theirs", headers));

    expect((await preview(draft)).conflicts).toEqual([
      expect.objectContaining({ entity: "repeatableItem", id: first.id }),
    ]);
    await publish(draft);
    expect(await labelOf(first.id)).toBe("First");
  });

  it("lists an item whose block exists neither in Live nor in the draft as lost, and leaves it off Live", async () => {
    const {
      addItem,
      createBlock,
      deleteBlock,
      linksOf,
      member,
      preview,
      publish,
      publishedOnLive,
    } = await fixture();
    const block = await createBlock("Hero");
    const kept = await createBlock("Kept");
    const draft = generateUuidv7();
    const item = await addItem(block.id, "Mine", startingDraft(draft));
    await addItem(kept.id, "Kept item", inDraft(draft));
    await publishedOnLive((headers) => deleteBlock(block.id, headers));

    const { lost, conflicts } = await preview(draft);
    expect(lost).toEqual([
      expect.objectContaining({ entity: "repeatableItem", id: item.id, reason: "parentGone" }),
    ]);
    expect(conflicts).toEqual([]);

    await publish(draft);
    await expect(call(router.repeatableItems.get, { id: item.id }, member())).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    expect(await linksOf(kept.id)).toEqual(["Kept item"]);
  });

  it("lists Live items published under a block after the draft deleted it as lost", async () => {
    const { addItem, createBlock, deleteBlock, member, preview, publish, publishedOnLive } =
      await fixture();
    const block = await createBlock("Hero");
    const draft = generateUuidv7();
    await deleteBlock(block.id, startingDraft(draft));
    let added: { id: string } | undefined;
    await publishedOnLive(async (headers) => {
      added = await addItem(block.id, "Theirs", headers);
    });

    expect((await preview(draft)).lost).toEqual([
      expect.objectContaining({
        entity: "repeatableItem",
        id: added!.id,
        reason: "writtenAfterDeletion",
      }),
    ]);
    await publish(draft);
    await expect(
      call(router.repeatableItems.get, { id: added!.id }, member()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
