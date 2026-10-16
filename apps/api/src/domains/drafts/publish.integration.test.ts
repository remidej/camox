import { DRAFT_CREATE_HEADER, DRAFT_HEADER, type DraftKind } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  seedingLive,
  callSeedingLive,
  openDevelopmentDraft,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { blocks, drafts, pages } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";

const { broadcastInvalidation, broadcastDraftEnded } = vi.hoisted(() => {
  // Modules loaded by earlier test files would keep the real broadcaster.
  vi.resetModules();
  return { broadcastInvalidation: vi.fn(), broadcastDraftEnded: vi.fn() };
});
vi.mock("../../lib/broadcast-invalidation", () => ({ broadcastInvalidation, broadcastDraftEnded }));

/** Headers naming a draft, creating it when missing. */
const startingDraft = (id: string) => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
/** Headers naming an existing draft. */
const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });

async function fixture() {
  const base = await createProjectFixture(`publish-${crypto.randomUUID()}`);
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
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      blockId: "quote",
      title: "Quote",
      description: "Quote",
      contentSchema: {
        type: "object",
        properties: {
          title: { fieldType: "String", type: "string" },
          author: {
            anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
            fieldType: "Reference",
            collectionId: "authors",
            required: true,
            default: null,
          },
        },
        toMarkdown: ["# {{title}}"],
      },
    }),
  );
  const now = 1_700_000_000_000;
  const createPage = (fullPath: string) =>
    base.db
      .insert(pages)
      .values({
        projectId: base.project.id,
        layoutId: base.layout.layoutId,
        pathSegment: fullPath.slice(1),
        fullPath,
        nickname: fullPath,
        contentUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  const page = await createPage("/");

  const member = (headers: Record<string, string> = {}) => ({
    context: createRpcContext(base.db, base.memberUser, headers),
  });
  const projectId = base.project.id;

  const createBlock = (
    title: string,
    headers: Record<string, string> = {},
    { type = "hero", pageId = page.id } = {},
  ) => callSeedingLive(router.blocks.create, { pageId, type, content: { title } }, member(headers));
  const editTitle = (id: string, title: string, headers: Record<string, string> = {}) =>
    callSeedingLive(router.blocks.updateContent, { id, content: { title } }, member(headers));
  const deleteBlock = (id: string, headers: Record<string, string> = {}) =>
    callSeedingLive(router.blocks.delete, { id }, member(headers));
  const titleIn = async (id: string, headers: Record<string, string> = {}) =>
    (await call(router.blocks.get, { id }, member(headers))).block.content.title;
  const pageTitles = async (headers: Record<string, string> = {}, pageId = page.id) =>
    (await call(router.blocks.getPageMarkdown, { pageId }, member(headers))).blocks.map(
      (block) => block.markdown.split("\n# ")[1],
    );

  const preview = (draftId: string) =>
    call(router.drafts.previewPublish, { projectId }, member(inDraft(draftId)));
  const publishWith = (draftId: string, token: string) =>
    call(router.drafts.publish, { projectId, token }, member(inDraft(draftId)));
  const publish = async (draftId: string) => publishWith(draftId, (await preview(draftId)).token);
  const discard = (draftId: string) =>
    call(router.drafts.discard, { projectId }, member(inDraft(draftId)));

  /** Changes Live the way it changes in v1: by publishing another draft. */
  const publishedOnLive = async (change: (headers: Record<string, string>) => Promise<unknown>) => {
    const other = generateUuidv7();
    await change(startingDraft(other));
    await publish(other);
  };

  /** A draft opened without any content, as the member. */
  const openDraft = async (kind: DraftKind) => {
    if (kind === "development") {
      return openDevelopmentDraft(base.db, projectId, base.memberUser.id);
    }
    const id = generateUuidv7();
    await base.db.insert(drafts).values({
      id,
      projectId,
      kind,
      createdBy: base.memberUser.id,
      createdAt: Date.now(),
    });
    return id;
  };

  return {
    ...base,
    page,
    openDraft,
    createPage,
    member,
    createBlock,
    editTitle,
    deleteBlock,
    titleIn,
    pageTitles,
    preview,
    publish,
    publishWith,
    discard,
    publishedOnLive,
  };
}

describe("publishing a draft", () => {
  it("applies every block the draft created, changed or deleted to Live at once, and ends the draft", async () => {
    const { createBlock, editTitle, deleteBlock, pageTitles, publish, titleIn } = await fixture();
    const changed = await createBlock("Changed");
    const removed = await createBlock("Removed");
    const draft = generateUuidv7();
    await editTitle(changed.id, "Changed in draft", startingDraft(draft));
    await deleteBlock(removed.id, inDraft(draft));
    await createBlock("Created", inDraft(draft));

    const result = await publish(draft);

    expect(result.ended).toMatchObject({ outcome: "published", endedBy: { name: "Member" } });
    expect(broadcastDraftEnded).toHaveBeenCalledWith(
      expect.objectContaining({ ended: result.ended }),
    );
    expect(await pageTitles()).toEqual(["Changed in draft", "Created"]);
    await expect(titleIn(changed.id, inDraft(draft))).rejects.toMatchObject({
      status: 410,
      data: { outcome: "published" },
    });
  });

  it("lists a block Live changed after the draft copied it as a conflict, with who published it and when, and overwrites it", async () => {
    const { createBlock, editTitle, preview, publish, publishedOnLive, titleIn } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Mine", startingDraft(draft));
    const before = Date.now();
    await publishedOnLive((headers) => editTitle(block.id, "Theirs", headers));

    const { conflicts } = await preview(draft);

    expect(conflicts).toEqual([
      expect.objectContaining({
        entity: "block",
        id: block.id,
        publishedBy: expect.objectContaining({ name: "Member" }),
      }),
    ]);
    expect(conflicts[0].publishedAt).toBeGreaterThanOrEqual(before);
    await publish(draft);
    expect(await titleIn(block.id)).toBe("Mine");
  });

  it("aborts with nothing applied when Live changes between preview and publish, and a new preview shows the conflict", async () => {
    const { createBlock, editTitle, preview, publishWith, publishedOnLive, titleIn } =
      await fixture();
    const block = await createBlock("Live");
    const other = await createBlock("Other");
    const draft = generateUuidv7();
    await editTitle(block.id, "Mine", startingDraft(draft));
    await editTitle(other.id, "Other in draft", inDraft(draft));
    const { token, conflicts } = await preview(draft);
    expect(conflicts).toEqual([]);

    await publishedOnLive((headers) => editTitle(block.id, "Theirs", headers));

    await expect(publishWith(draft, token)).rejects.toMatchObject({
      code: "CONFLICTS_CHANGED",
    });
    expect(await titleIn(block.id)).toBe("Theirs");
    expect(await titleIn(other.id)).toBe("Other");
    expect((await preview(draft)).conflicts.map((conflict) => conflict.id)).toEqual([block.id]);
  });

  it("brings back a block Live deleted after the draft copied it, with its id and the draft's content", async () => {
    const { createBlock, deleteBlock, editTitle, preview, publish, publishedOnLive, titleIn } =
      await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Mine", startingDraft(draft));
    await publishedOnLive((headers) => deleteBlock(block.id, headers));
    await expect(titleIn(block.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { conflicts } = await preview(draft);
    expect(conflicts).toEqual([expect.objectContaining({ id: block.id, liveVersion: null })]);
    await publish(draft);

    expect(await titleIn(block.id)).toBe("Mine");
  });

  it("lists changes whose page is gone as lost, and leaves them off Live", async () => {
    const {
      createBlock,
      createPage,
      editTitle,
      member,
      preview,
      publish,
      publishedOnLive,
      titleIn,
    } = await fixture();
    const about = await createPage("/about");
    const changed = await createBlock("Live", {}, { pageId: about.id });
    const draft = generateUuidv7();
    await editTitle(changed.id, "Mine", startingDraft(draft));
    const created = await createBlock("Created", inDraft(draft), { pageId: about.id });
    await publishedOnLive((headers) =>
      call(router.pages.delete, { id: about.id }, member(headers)),
    );

    const { lost, conflicts } = await preview(draft);
    expect(
      lost.map(({ id, reason }) => ({ id, reason })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    ).toEqual([changed.id, created.id].sort().map((id) => ({ id, reason: "parentGone" })));
    expect(conflicts).toEqual([]);

    await publish(draft);
    await expect(titleIn(changed.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(titleIn(created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists Live items added to a block after the draft deleted it as lost, and deletes them with the block", async () => {
    const { createBlock, deleteBlock, member, preview, publish } = await fixture();
    const block = await createBlock("Live");
    const before = await call(
      seedingLive(router.repeatableItems.create),
      { blockId: block.id, fieldName: "links", content: { label: "Before" } },
      member(),
    );
    const draft = generateUuidv7();
    await deleteBlock(block.id, startingDraft(draft));
    const after = await call(
      seedingLive(router.repeatableItems.create),
      { blockId: block.id, fieldName: "links", content: { label: "After" } },
      member(),
    );

    const { lost } = await preview(draft);
    expect(lost).toEqual([
      expect.objectContaining({ id: after.id, reason: "writtenAfterDeletion" }),
    ]);

    await publish(draft);
    for (const item of [before, after]) {
      await expect(
        call(router.repeatableItems.get, { id: item.id }, member()),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("lists Live descendants published after the draft deleted their page as conflicts, with who published them", async () => {
    const { createBlock, createPage, member, preview, publish, publishedOnLive, titleIn } =
      await fixture();
    const about = await createPage("/about");
    const older = await createBlock("Older", {}, { pageId: about.id });
    const draft = generateUuidv7();
    await call(router.pages.delete, { id: about.id }, member(startingDraft(draft)));
    const before = Date.now();
    let added = { id: "" };
    await publishedOnLive(async (headers) => {
      added = await createBlock("Added", headers, { pageId: about.id });
    });
    const item = await call(
      seedingLive(router.repeatableItems.create),
      { blockId: older.id, fieldName: "links", content: { label: "Added" } },
      member(),
    );

    const { conflicts, lost } = await preview(draft);

    expect(
      conflicts.map(({ entity, id }) => ({ entity, id })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    ).toEqual(
      [
        { entity: "block", id: added.id },
        { entity: "repeatableItem", id: item.id },
      ].sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    expect(conflicts.find((conflict) => conflict.id === added.id)).toMatchObject({
      publishedBy: expect.objectContaining({ name: "Member" }),
      publishedAt: expect.any(Number),
    });
    expect(
      conflicts.find((conflict) => conflict.id === added.id)!.publishedAt,
    ).toBeGreaterThanOrEqual(before);
    expect(lost.map(({ id, reason }) => ({ id, reason }))).toEqual(
      expect.arrayContaining([
        { id: added.id, reason: "writtenAfterDeletion" },
        { id: item.id, reason: "writtenAfterDeletion" },
      ]),
    );
    expect(lost.map(({ id }) => id)).not.toContain(older.id);

    await publish(draft);
    await expect(titleIn(added.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(titleIn(older.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("aborts when a Live descendant of what the draft deletes is published between preview and publish", async () => {
    const { createBlock, createPage, member, preview, publishWith, publishedOnLive, titleIn } =
      await fixture();
    const about = await createPage("/about");
    const draft = generateUuidv7();
    await call(router.pages.delete, { id: about.id }, member(startingDraft(draft)));
    const { token, conflicts } = await preview(draft);
    expect(conflicts).toEqual([]);

    let added = { id: "" };
    await publishedOnLive(async (headers) => {
      added = await createBlock("Added", headers, { pageId: about.id });
    });

    await expect(publishWith(draft, token)).rejects.toMatchObject({
      code: "CONFLICTS_CHANGED",
    });
    expect(await titleIn(added.id)).toBe("Added");
    expect((await preview(draft)).conflicts.map((conflict) => conflict.id)).toEqual([added.id]);
  });

  it("blocks publishing on an empty required reference in a block the draft changed", async () => {
    const { createBlock, editTitle, preview, publish, publishWith, titleIn } = await fixture();
    const quote = await createBlock("Quote", {}, { type: "quote" });
    const draft = generateUuidv7();
    await editTitle(quote.id, "Edited quote", startingDraft(draft));

    const { blockers, warnings, token } = await preview(draft);

    expect(blockers).toEqual([
      expect.objectContaining({
        code: "emptyRequiredReference",
        entity: "block",
        id: quote.id,
        field: "author",
      }),
    ]);
    expect(warnings).toEqual([]);
    await expect(publishWith(draft, token)).rejects.toMatchObject({ code: "PUBLISH_BLOCKED" });
    expect(await titleIn(quote.id)).toBe("Quote");
    await expect(publish(draft)).rejects.toMatchObject({ code: "PUBLISH_BLOCKED" });
  });

  it("only warns about an empty required reference in an untouched Live block", async () => {
    const { createBlock, editTitle, preview, publish, titleIn } = await fixture();
    const quote = await createBlock("Quote", {}, { type: "quote" });
    const hero = await createBlock("Hero");
    const draft = generateUuidv7();
    await editTitle(hero.id, "Hero in draft", startingDraft(draft));

    const { blockers, warnings } = await preview(draft);

    expect(blockers).toEqual([]);
    expect(warnings).toEqual([
      expect.objectContaining({ code: "emptyRequiredReference", id: quote.id, field: "author" }),
    ]);
    await publish(draft);
    expect(await titleIn(hero.id)).toBe("Hero in draft");
  });

  it("reports the earlier outcome when a publish that already succeeded is retried, applying nothing twice", async () => {
    const { createBlock, editTitle, preview, publishWith, publishedOnLive, titleIn } =
      await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Mine", startingDraft(draft));
    const { token } = await preview(draft);
    const first = await publishWith(draft, token);
    await publishedOnLive((headers) => editTitle(block.id, "Theirs", headers));

    const retried = await publishWith(draft, token);

    expect(retried.ended).toEqual(first.ended);
    expect(retried.ended).toMatchObject({ outcome: "published", endedBy: { name: "Member" } });
    expect(await titleIn(block.id)).toBe("Theirs");
  });

  it("keeps first_published_at from the first publish on later ones", async () => {
    const { createBlock, db, editTitle, publish } = await fixture();
    const draft = generateUuidv7();
    const block = await createBlock("Created", startingDraft(draft));
    await publish(draft);
    const firstPublishedAt = async () =>
      (await db
        .select({ at: blocks.firstPublishedAt, published: blocks.publishedAt })
        .from(blocks)
        .where(and(eq(blocks.id, block.id), isNull(blocks.draftId)))
        .get())!;
    const first = await firstPublishedAt();
    expect(first.at).toEqual(first.published);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const next = generateUuidv7();
    await editTitle(block.id, "Again", startingDraft(next));
    await publish(next);

    const later = await firstPublishedAt();
    expect(later.at).toBe(first.at);
    expect(later.published).toBeGreaterThan(first.at!);
  });

  it("leaves other open drafts untouched, their unchanged blocks showing the new Live", async () => {
    const { createBlock, editTitle, publish, titleIn } = await fixture();
    const shared = await createBlock("Shared");
    const kept = await createBlock("Kept");
    const draft = generateUuidv7();
    const other = generateUuidv7();
    await editTitle(shared.id, "Published", startingDraft(draft));
    await editTitle(kept.id, "Other's edit", startingDraft(other));

    await publish(draft);

    expect(await titleIn(shared.id, inDraft(other))).toBe("Published");
    expect(await titleIn(kept.id, inDraft(other))).toBe("Other's edit");
    expect(await titleIn(kept.id)).toBe("Kept");
  });

  it("does nothing when publishing an empty draft", async () => {
    const { createBlock, openDraft, preview, publish, titleIn } = await fixture();
    const block = await createBlock("Live");
    const draft = await openDraft("regular");

    expect(await publish(draft)).toEqual({ ended: null });

    expect((await preview(draft)).changes).toEqual([]);
    expect(await titleIn(block.id, inDraft(draft))).toBe("Live");
  });

  it("empties a development draft on publish and keeps it open", async () => {
    const { createBlock, editTitle, openDraft, preview, publish, titleIn } = await fixture();
    const block = await createBlock("Live");
    const draft = await openDraft("development");
    await editTitle(block.id, "From development", inDraft(draft));

    await publish(draft);

    expect(await titleIn(block.id)).toBe("From development");
    expect((await preview(draft)).changes).toEqual([]);
    await editTitle(block.id, "Next", inDraft(draft));
    expect(await titleIn(block.id, inDraft(draft))).toBe("Next");
  });
});

describe("discarding a draft", () => {
  it("removes every draft row, and later writes fail with the outcome and who discarded it", async () => {
    const { createBlock, db, discard, editTitle, pageTitles, titleIn } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Mine", startingDraft(draft));
    await createBlock("Created", inDraft(draft));

    const { ended } = await discard(draft);

    expect(ended).toMatchObject({ outcome: "discarded", endedBy: { name: "Member" } });
    expect(broadcastDraftEnded).toHaveBeenCalledWith(expect.objectContaining({ ended }));
    expect(await db.select().from(blocks).where(eq(blocks.draftId, draft))).toEqual([]);
    expect(await pageTitles()).toEqual(["Live"]);
    await expect(editTitle(block.id, "Again", inDraft(draft))).rejects.toMatchObject({
      status: 410,
      data: { outcome: "discarded", endedBy: { name: "Member" } },
    });
    expect(await titleIn(block.id)).toBe("Live");
  });

  it("never brings an ended draft back through the create header", async () => {
    const { createBlock, discard, editTitle, titleIn } = await fixture();
    const block = await createBlock("Live");
    const draft = generateUuidv7();
    await editTitle(block.id, "Mine", startingDraft(draft));
    await discard(draft);

    await expect(editTitle(block.id, "Back", startingDraft(draft))).rejects.toMatchObject({
      status: 410,
      data: { outcome: "discarded" },
    });
    await expect(titleIn(block.id, inDraft(draft))).rejects.toMatchObject({ status: 410 });
  });
});
