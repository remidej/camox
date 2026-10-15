import { DRAFT_CREATE_HEADER, DRAFT_HEADER, type DraftKind } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { queryKeys } from "@camox/api-contract/query-keys";
import { call } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";

import {
  createProjectFixture,
  createRpcContext,
  createServiceContext,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { drafts, member, pages, user } from "../../schema";
import { syncBlockDefinitions } from "../block-definitions/service";
import { syncLayouts } from "../layouts/service";

const { broadcastInvalidation, broadcastDraftEnded } = vi.hoisted(() => {
  // Modules loaded by earlier test files would keep the real broadcaster.
  vi.resetModules();
  return { broadcastInvalidation: vi.fn(), broadcastDraftEnded: vi.fn() };
});
vi.mock("../../lib/broadcast-invalidation", () => ({ broadcastInvalidation, broadcastDraftEnded }));

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
  const as = (who: typeof ada | null, headers: Record<string, string> = {}) => ({
    context: createRpcContext(base.db, who, headers),
  });
  const me = base.memberUser;

  const createBlock = (who: typeof ada, headers: Record<string, string> = {}) =>
    call(router.blocks.create, { pageId: page.id, type: "hero", content: {} }, as(who, headers));
  const editBlock = (who: typeof ada, id: string, title: string, headers: Record<string, string>) =>
    call(router.blocks.updateContent, { id, content: { title } }, as(who, headers));
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
      { projectId, token: (await preview(draftId)).token },
      as(who, inDraft(draftId)),
    );
  const discard = (draftId: string) =>
    call(router.drafts.discard, { projectId }, as(me, inDraft(draftId)));

  /** A draft opened without content, created by `who`. */
  const openDraft = async (kind: DraftKind, who: typeof ada = me) => {
    const id = generateUuidv7();
    await base.db
      .insert(drafts)
      .values({ id, projectId, kind, createdBy: who.id, createdAt: Date.now() });
    return id;
  };

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
    discard,
    openDraft,
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
      kind: "regular",
      name: null,
      createdBy: { id: me.id, name: "Member" },
      changeCount: (await preview(mine)).changes.length,
    });
    expect(byId.get(mine)?.changeCount).toBe(2);
    expect(byId.get(mine)?.createdAt).toBeGreaterThanOrEqual(before);
    expect(byId.get(mine)?.lastChangedAt).toBeGreaterThanOrEqual(byId.get(mine)!.createdAt);
    expect(byId.get(theirs)).toMatchObject({ createdBy: { name: "Ada" }, changeCount: 1 });
  });

  it("drops a draft once it's published or discarded", async () => {
    const { me, createBlock, list, publish, discard } = await fixture();
    const published = generateUuidv7();
    const discarded = generateUuidv7();
    await createBlock(me, startingDraft(published));
    await createBlock(me, startingDraft(discarded));

    await publish(published);
    await discard(discarded);

    expect((await list()).drafts.map((draft) => draft.id)).not.toContain(published);
    expect((await list()).drafts.map((draft) => draft.id)).not.toContain(discarded);
  });

  it("lists the caller's development draft but never another member's", async () => {
    const { ada, list, openDraft } = await fixture();
    const mine = await openDraft("development");
    const adas = await openDraft("development", ada);

    const ids = (await list()).drafts.map((draft) => draft.id);

    expect(ids).toContain(mine);
    expect(ids).not.toContain(adas);
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

  it("counts a development draft's publish as Live's latest publish", async () => {
    const { me, createBlock, list, publish, openDraft } = await fixture();
    const development = await openDraft("development");
    await createBlock(me, inDraft(development));

    await publish(development);

    expect((await list()).live.publishedBy).toEqual({ id: me.id, name: "Member" });
  });

  it("counts a release writing Live as Live's latest publish, by a release", async () => {
    const { db, project, me, createBlock, list, publish } = await fixture();
    const draft = generateUuidv7();
    await createBlock(me, startingDraft(draft));
    await publish(draft);
    const build = createServiceContext(db, null);
    const token = {
      projectSlug: project.slug,
      deployToken: project.deployToken,
      autoCreate: false,
    };
    await runService(
      syncBlockDefinitions(build, {
        ...token,
        definitions: [
          {
            blockId: "banner",
            title: "Banner",
            description: "Banner",
            layoutOnly: true,
            contentSchema: { type: "object", properties: {}, toMarkdown: [] },
          },
        ],
      }),
    );
    const before = Date.now();
    await runService(
      syncLayouts(build, {
        ...token,
        layouts: [
          {
            layoutId: "default",
            description: "default",
            blocks: [{ type: "banner", content: {} }],
          },
        ],
      }),
    );

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
      kind: "regular",
      name: null,
      createdBy: { id: ada.id, name: "Ada" },
      changeCount: 2,
    });
  });

  it("fails with the draft's outcome once it ended", async () => {
    const { me, createBlock, get, discard } = await fixture();
    const draft = generateUuidv7();
    await createBlock(me, startingDraft(draft));
    await discard(draft);

    await expect(get(draft)).rejects.toMatchObject({
      status: 410,
      data: { outcome: "discarded" },
    });
  });
});

describe("renaming a draft", () => {
  it("lets any member rename any regular draft, for every member", async () => {
    const { ada, me, createBlock, get, list, rename } = await fixture();
    const draft = generateUuidv7();
    await createBlock(me, startingDraft(draft));

    await rename(draft, "  Spring campaign ", ada);

    expect((await get(draft, me)).name).toBe("Spring campaign");
    expect((await list(ada)).drafts.find((listed) => listed.id === draft)?.name).toBe(
      "Spring campaign",
    );
    expect(broadcastInvalidation).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: null, targets: [queryKeys.drafts.all] }),
    );
  });

  it("clears the name back to the computed label when renamed to nothing", async () => {
    const { me, createBlock, get, rename } = await fixture();
    const draft = generateUuidv7();
    await createBlock(me, startingDraft(draft));
    await rename(draft, "Named");

    await rename(draft, "   ");

    expect((await get(draft)).name).toBeNull();
  });

  it("refuses to rename a development draft", async () => {
    const { rename, openDraft } = await fixture();
    const development = await openDraft("development");

    await expect(rename(development, "Mine")).rejects.toMatchObject({ status: 400 });
  });
});
