import type { CommentTarget } from "@camox/api-contract";
import { DRAFT_HEADER, type DraftKind } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  callSeedingLive,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { drafts, pages } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";

const { broadcastInvalidation, broadcastDraftEnded } = vi.hoisted(() => {
  // Modules loaded by earlier test files would keep the real broadcaster.
  vi.resetModules();
  return { broadcastInvalidation: vi.fn(), broadcastDraftEnded: vi.fn() };
});
vi.mock("../../lib/broadcast-invalidation", () => ({ broadcastInvalidation, broadcastDraftEnded }));

/** Headers naming an existing draft. */
const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });
const onLive = {};

async function fixture() {
  const base = await createProjectFixture(`draft-comments-${crypto.randomUUID()}`);
  /** Releases the hero definition, with or without its subtitle field. */
  const releaseHero = ({ subtitle }: { subtitle: boolean }) =>
    runService(
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
            ...(subtitle ? { subtitle: { fieldType: "String", type: "string" } } : {}),
          },
          toMarkdown: ["# {{title}}"],
        },
      }),
    );
  await releaseHero({ subtitle: true });
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
  const projectId = base.project.id;
  const member = (headers: Record<string, string>) => ({
    context: createRpcContext(base.db, base.memberUser, headers),
  });

  const createBlock = (title: string, headers: Record<string, string> = onLive) =>
    callSeedingLive(
      router.blocks.create,
      { pageId: page.id, type: "hero", content: { title } },
      member(headers),
    );
  const deleteBlock = (id: string, headers: Record<string, string>) =>
    callSeedingLive(router.blocks.delete, { id }, member(headers));
  const comment = (
    headers: Record<string, string>,
    target: CommentTarget = { kind: "page" },
    message = "Feedback",
  ) => call(router.comments.create, { pageId: page.id, message, target }, member(headers));
  const list = (headers: Record<string, string>) =>
    call(router.comments.list, { pageId: page.id }, member(headers));
  const messages = async (headers: Record<string, string>) =>
    (await list(headers)).map((entry) => entry.message);
  const setResolved = (headers: Record<string, string>, id: string, resolved: boolean) =>
    call(router.comments.setResolved, { pageId: page.id, id, resolved }, member(headers));

  const preview = (draftId: string) =>
    call(router.drafts.previewPublish, { projectId }, member(inDraft(draftId)));
  const publish = async (draftId: string) =>
    call(
      router.drafts.publish,
      { projectId, token: (await preview(draftId)).token },
      member(inDraft(draftId)),
    );
  const discard = (draftId: string) =>
    call(router.drafts.discard, { projectId }, member(inDraft(draftId)));

  /** A draft the member opened, holding one block edit so it has something to publish. */
  const openDraft = async (name: string | null = null, kind: DraftKind = "regular") => {
    const id = generateUuidv7();
    await base.db.insert(drafts).values({
      id,
      projectId,
      kind,
      name,
      createdBy: base.memberUser.id,
      createdAt: now,
    });
    await createBlock("Draft work", inDraft(id));
    return id;
  };

  return {
    ...base,
    page,
    releaseHero,
    createBlock,
    deleteBlock,
    comment,
    list,
    messages,
    setResolved,
    preview,
    publish,
    discard,
    openDraft,
  };
}

describe("comments in drafts", () => {
  it("shows a Live comment in every draft, and a draft's comment only in that draft", async () => {
    const f = await fixture();
    const first = await f.openDraft();
    const second = await f.openDraft();

    await f.comment(onLive, { kind: "page" }, "On Live");
    await f.comment(inDraft(first), { kind: "page" }, "In first");

    expect(await f.messages(onLive)).toEqual(["On Live"]);
    expect(await f.messages(inDraft(first))).toEqual(["On Live", "In first"]);
    expect(await f.messages(inDraft(second))).toEqual(["On Live"]);
  });

  it("removes a draft's comments when the draft is published or discarded", async () => {
    const f = await fixture();
    const published = await f.openDraft();
    const discarded = await f.openDraft();
    const resolved = await f.comment(inDraft(published), { kind: "page" }, "Resolved in draft");
    await f.setResolved(inDraft(published), resolved.id, true);
    await f.comment(inDraft(discarded), { kind: "page" }, "In discarded");

    await f.publish(published);
    await f.discard(discarded);

    expect(await f.messages(onLive)).toEqual([]);
    expect(await f.messages(inDraft(await f.openDraft()))).toEqual([]);
  });

  it("empties a development draft of its comments when it's published or discarded", async () => {
    const f = await fixture();
    const development = await f.openDraft(null, "development");
    const resolved = await f.comment(inDraft(development), { kind: "page" }, "Before publishing");
    await f.setResolved(inDraft(development), resolved.id, true);
    await f.publish(development);
    await f.createBlock("More work", inDraft(development));
    await f.comment(inDraft(development), { kind: "page" }, "Before discarding");

    await f.discard(development);

    expect(await f.messages(inDraft(development))).toEqual([]);
  });

  it("starts no draft when commenting on Live", async () => {
    const f = await fixture();

    const created = await f.comment(onLive);

    expect(created.draftId).toBeNull();
    expect(await f.db.select().from(drafts).where(eq(drafts.projectId, f.project.id))).toEqual([]);
  });

  it("marks a Live comment resolved from a draft as addressed there, which publishing resolves", async () => {
    const f = await fixture();
    const draft = await f.openDraft("Copy fixes");
    const other = await f.openDraft();
    const live = await f.comment(onLive, { kind: "page" }, "Typo");

    await f.setResolved(inDraft(draft), live.id, true);

    const addressed = {
      resolved: false,
      addressedIn: expect.objectContaining({ draftId: draft, name: "Copy fixes" }),
    };
    expect(await f.list(onLive)).toEqual([expect.objectContaining(addressed)]);
    expect(await f.list(inDraft(other))).toEqual([expect.objectContaining(addressed)]);

    await f.publish(draft);

    expect(await f.list(onLive)).toEqual([
      expect.objectContaining({ resolved: true, addressedIn: null }),
    ]);
  });

  it("clears the addressed mark when the draft is discarded", async () => {
    const f = await fixture();
    const draft = await f.openDraft();
    const live = await f.comment(onLive, { kind: "page" }, "Typo");
    await f.setResolved(inDraft(draft), live.id, true);

    await f.discard(draft);

    expect(await f.list(onLive)).toEqual([
      expect.objectContaining({ resolved: false, addressedIn: null }),
    ]);
  });

  it("deletes a draft's comment on a block the draft deletes right away", async () => {
    const f = await fixture();
    const block = await f.createBlock("Hero");
    const draft = await f.openDraft();
    await f.comment(inDraft(draft), { kind: "block", blockId: block.id }, "On the block");
    await f.comment(inDraft(draft), { kind: "page" }, "On the page");

    await f.deleteBlock(block.id, inDraft(draft));

    expect(await f.messages(inDraft(draft))).toEqual(["On the page"]);
  });

  it("shows a Live comment on a block the draft deletes as unavailable there, and publishing deletes it", async () => {
    const f = await fixture();
    const block = await f.createBlock("Hero");
    const kept = await f.createBlock("Kept");
    const target = { kind: "block", blockId: block.id } as const;
    await f.comment(onLive, target, "On the deleted block");
    await f.comment(onLive, { kind: "block", blockId: kept.id }, "On the kept block");
    const draft = await f.openDraft();

    await f.deleteBlock(block.id, inDraft(draft));

    expect(await f.list(inDraft(draft))).toEqual([
      expect.objectContaining({ message: "On the deleted block", target: null }),
      expect.objectContaining({ message: "On the kept block" }),
    ]);
    expect(await f.list(onLive)).toEqual([
      expect.objectContaining({ message: "On the deleted block", target }),
      expect.objectContaining({ message: "On the kept block" }),
    ]);

    await f.publish(draft);

    expect(await f.messages(onLive)).toEqual(["On the kept block"]);
  });

  it("blocks publishing on an unresolved comment written in the draft until it's resolved", async () => {
    const f = await fixture();
    const draft = await f.openDraft();
    const feedback = await f.comment(inDraft(draft), { kind: "page" }, "Fix the heading");

    const { blockers, token } = await f.preview(draft);

    expect(blockers).toEqual([
      expect.objectContaining({
        code: "unresolvedComment",
        entity: "comment",
        id: feedback.id,
        owner: expect.objectContaining({ kind: "page", id: f.page.id }),
      }),
    ]);
    await expect(
      call(
        router.drafts.publish,
        { projectId: f.project.id, token },
        { context: createRpcContext(f.db, f.memberUser, inDraft(draft)) },
      ),
    ).rejects.toMatchObject({ status: 422 });

    await f.setResolved(inDraft(draft), feedback.id, true);

    expect((await f.preview(draft)).blockers).toEqual([]);
    expect((await f.publish(draft)).ended).toMatchObject({ outcome: "published" });
  });

  it("warns about unresolved Live comments the publish will delete", async () => {
    const f = await fixture();
    const block = await f.createBlock("Hero");
    const target = { kind: "block", blockId: block.id } as const;
    const unresolved = await f.comment(onLive, target, "Still open");
    const resolved = await f.comment(onLive, target, "Done");
    await f.setResolved(onLive, resolved.id, true);
    const addressed = await f.comment(onLive, target, "Addressed");
    const draft = await f.openDraft();
    await f.setResolved(inDraft(draft), addressed.id, true);

    await f.deleteBlock(block.id, inDraft(draft));

    const { warnings, blockers } = await f.preview(draft);
    expect(blockers).toEqual([]);
    expect(warnings).toEqual([
      expect.objectContaining({ code: "commentDeleted", entity: "comment", id: unresolved.id }),
    ]);
  });

  it("keeps a comment on a field a release removed as unavailable, and shows it again once the field is back", async () => {
    const f = await fixture();
    const block = await f.createBlock("Hero");
    const target = { kind: "block-field", blockId: block.id, fieldName: "subtitle" } as const;
    await f.comment(onLive, target, "Shorter subtitle");

    await f.releaseHero({ subtitle: false });
    expect(await f.list(onLive)).toEqual([expect.objectContaining({ target: null })]);

    await f.releaseHero({ subtitle: true });
    expect(await f.list(onLive)).toEqual([expect.objectContaining({ target })]);
  });
});
