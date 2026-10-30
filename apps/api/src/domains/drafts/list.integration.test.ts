import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { queryKeys } from "@camox/api-contract/query-keys";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  reviewed,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { refreshes, sentTo } from "../../../test/project-rooms";
import { router } from "../../router";
import { member, pages, user } from "../../schema";

const startingDraft = (id: string) => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });

async function fixture() {
  const suffix = crypto.randomUUID();
  const base = await createProjectFixture(`drafts-list-${suffix}`);
  const [ada] = await base.db
    .insert(user)
    .values({
      id: `ada-${suffix}`,
      name: "Ada",
      email: `ada-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  const organizationId = base.project.organizationId;
  await base.db.insert(member).values({
    id: `membership-ada-${suffix}`,
    organizationId,
    userId: ada.id,
    role: "member",
    createdAt: new Date(),
  });

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
  const as = (who: typeof ada | null, headers: Record<string, string> = {}) => ({
    context: createRpcContext(base.db, who, headers),
  });
  const me = base.memberUser;

  const createBlock = (who: typeof ada, headers: Record<string, string> = {}) =>
    callSeedingLive(
      router.blocks.create,
      { pageId: page.id, type: "hero", content: {} },
      as(who, headers),
    );
  const editBlock = (who: typeof ada, id: string, title: string, headers: Record<string, string>) =>
    callSeedingLive(router.blocks.updateContent, { id, content: { title } }, as(who, headers));
  const list = (who: typeof ada = me) => call(router.drafts.list, { projectId }, as(who));
  const get = (draftId: string, who: typeof ada = me) =>
    call(router.drafts.get, { projectId }, as(who, inDraft(draftId)));
  const rename = (draftId: string, name: string | null, who: typeof ada = me) =>
    call(router.drafts.rename, { projectId, name }, as(who, inDraft(draftId)));
  const preview = (draftId: string) =>
    call(router.drafts.previewPublish, { projectId }, as(me, inDraft(draftId)));
  const publish = async (draftId: string, who: typeof ada = me) =>
    call(
      router.drafts.publish,
      { projectId, token: (await reviewed(base.db, draftId, preview(draftId))).token },
      as(who, inDraft(draftId)),
    );
  const deleteDraft = (draftId: string) =>
    call(router.drafts.delete, { projectId }, as(me, inDraft(draftId)));

  return {
    ...base,
    ada,
    me,
    as,
    createBlock,
    editBlock,
    list,
    get,
    rename,
    preview,
    publish,
    deleteDraft,
  };
}

describe("listing drafts", () => {
  it("lists every open regular draft with its creator, age, last change and a change count matching its publish preview", async () => {
    const { ada, me, createBlock, editBlock, list, preview } = await fixture();
    const live = await createBlock(me);
    const mine = generateUuidv7();
    const before = Date.now();
    await editBlock(me, live.id, "Mine", startingDraft(mine));
    await createBlock(me, inDraft(mine));
    const theirs = generateUuidv7();
    await createBlock(ada, startingDraft(theirs));

    const { drafts: listed } = await list(ada);

    const byId = new Map(listed.map((draft) => [draft.id, draft]));
    expect(byId.get(mine)).toMatchObject({
      name: null,
      createdBy: { id: me.id, name: "Member" },
      changeCount: (await preview(mine)).changes.length,
    });
    expect(byId.get(mine)?.changeCount).toBe(2);
    expect(byId.get(mine)?.createdAt).toBeGreaterThanOrEqual(before);
    expect(byId.get(mine)?.lastChangedAt).toBeGreaterThanOrEqual(byId.get(mine)!.createdAt);
    expect(byId.get(theirs)).toMatchObject({ createdBy: { name: "Ada" }, changeCount: 1 });
  });

  it("drops a draft once it's published or deleted", async () => {
    const { me, createBlock, list, publish, deleteDraft } = await fixture();
    const published = generateUuidv7();
    const deleted = generateUuidv7();
    await createBlock(me, startingDraft(published));
    await createBlock(me, startingDraft(deleted));
    const listed = async () => (await list()).drafts.map((draft) => draft.id);
    expect(await listed()).toEqual(expect.arrayContaining([published, deleted]));

    await publish(published);
    await deleteDraft(deleted);

    const after = await listed();
    expect(after).not.toContain(published);
    expect(after).not.toContain(deleted);
  });

  it("says who published Live last and when, from the most recently published Live content", async () => {
    const { ada, me, createBlock, list, publish } = await fixture();
    expect((await list()).live).toEqual({ publishedBy: null, publishedAt: null, release: false });

    const first = generateUuidv7();
    await createBlock(me, startingDraft(first));
    await publish(first);
    const second = generateUuidv7();
    await createBlock(ada, startingDraft(second));
    const before = Date.now();
    await publish(second, ada);

    const { live } = await list();
    expect(live.publishedBy).toEqual({ id: ada.id, name: "Ada" });
    expect(live.publishedAt).toBeGreaterThanOrEqual(before);
  });

  it("counts a release writing Live as Live's latest publish, by a release", async () => {
    const { db, project, me, createBlock, list, publish } = await fixture();
    const draft = generateUuidv7();
    await createBlock(me, startingDraft(draft));
    await publish(draft);
    const before = Date.now();
    await syncDefinitionSet(db, project, {
      blocks: [
        {
          blockId: "banner",
          title: "Banner",
          description: "Banner",
          layoutOnly: true,
          contentSchema: { type: "object", properties: {}, toMarkdown: [] },
        },
      ],
      layouts: [
        {
          layoutId: "default",
          description: "default",
          blocks: [{ type: "banner", content: {} }],
        },
      ],
    });

    const { live } = await list();

    expect(live).toMatchObject({ publishedBy: null, release: true });
    expect(live.publishedAt).toBeGreaterThanOrEqual(before);
  });

  it("is refused to people outside the project", async () => {
    const { outsiderUser, list } = await fixture();

    await expect(list(outsiderUser)).rejects.toMatchObject({ status: 403 });
  });
});

describe("getting a draft", () => {
  it("returns the draft the request names, with its creator and change count", async () => {
    const { ada, me, createBlock, get } = await fixture();
    const draft = generateUuidv7();
    await createBlock(ada, startingDraft(draft));
    await createBlock(ada, inDraft(draft));

    expect(await get(draft, me)).toMatchObject({
      id: draft,
      name: null,
      createdBy: { id: ada.id, name: "Ada" },
      changeCount: 2,
    });
  });

  it("fails with the draft's outcome once it ended", async () => {
    const { me, createBlock, get, deleteDraft } = await fixture();
    const draft = generateUuidv7();
    await createBlock(me, startingDraft(draft));
    await deleteDraft(draft);

    await expect(get(draft)).rejects.toMatchObject({
      status: 410,
      data: { outcome: "deleted" },
    });
  });
});

describe("renaming a draft", () => {
  it("lets any member rename any regular draft, for every member", async () => {
    const { ada, me, createBlock, get, list, project, rename } = await fixture();
    const draft = generateUuidv7();
    await createBlock(me, startingDraft(draft));

    await rename(draft, "  Spring campaign ", ada);

    expect((await get(draft, me)).name).toBe("Spring campaign");
    expect((await list(ada)).drafts.find((listed) => listed.id === draft)?.name).toBe(
      "Spring campaign",
    );
    expect(refreshes(sentTo(project.id), null, [...queryKeys.drafts.list, project.id])).toBe(true);
  });

  it("clears the name back to the computed label when renamed to nothing", async () => {
    const { me, createBlock, get, rename } = await fixture();
    const draft = generateUuidv7();
    await createBlock(me, startingDraft(draft));
    await rename(draft, "Named");

    await rename(draft, "   ");

    expect((await get(draft)).name).toBeNull();
  });
});

describe("creating a draft", () => {
  it("creates an empty regular draft by the caller, named or not, listed for every member", async () => {
    const { ada, me, as, project, list, get } = await fixture();
    const before = Date.now();

    const named = await call(
      router.drafts.create,
      { projectId: project.id, name: "  Spring campaign " },
      as(ada),
    );
    const unnamed = await call(router.drafts.create, { projectId: project.id }, as(ada));

    expect(named).toMatchObject({
      name: "Spring campaign",
      createdBy: { id: ada.id, name: "Ada" },
      changeCount: 0,
      lastChangedAt: null,
    });
    expect(named.createdAt).toBeGreaterThanOrEqual(before);
    expect(unnamed.name).toBeNull();
    expect(unnamed.id).not.toBe(named.id);
    expect(await get(named.id, me)).toEqual(named);
    expect((await list(me)).drafts.map((draft) => draft.id)).toEqual(
      expect.arrayContaining([named.id, unnamed.id]),
    );
    expect(refreshes(sentTo(project.id), null, [...queryKeys.drafts.list, project.id])).toBe(true);
  });

  it("is refused to people outside the project", async () => {
    const { outsiderUser, as, project, list } = await fixture();

    await expect(
      call(router.drafts.create, { projectId: project.id, name: "Mine" }, as(outsiderUser)),
    ).rejects.toMatchObject({ status: 403 });
    expect((await list()).drafts).toEqual([]);
  });
});
