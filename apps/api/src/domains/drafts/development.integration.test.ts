import {
  DEVELOPMENT_DRAFT,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  NO_DEVELOPMENT_DRAFT_ERROR,
} from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { router } from "../../router";
import { blocks, drafts, member, pages, sharedContents, user } from "../../schema";

// Development drafts (ADR 0006): each member's dev mode syncs the definitions of their local
// code into their own development draft, which holds content like any draft and publishes once
// a release gave Live the same definitions.

const development = { [DRAFT_HEADER]: DEVELOPMENT_DRAFT };
const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });

const fields = {
  title: { type: "string", fieldType: "String" },
};
const schema = (extra: Record<string, unknown> = {}) => ({
  type: "object",
  properties: { ...fields, ...extra },
});

type Definition = {
  blockId: string;
  contentSchema?: unknown;
  synced?: boolean;
  layoutOnly?: boolean;
  title?: string;
};
type Layouts = Record<string, { type: string; slot?: "before" | "after" }[]>;

const definitionsInput = (definitions: Definition[]) =>
  definitions.map((definition) => ({
    title: definition.blockId,
    description: definition.blockId,
    contentSchema: schema(),
    ...definition,
  }));
const layoutsInput = (layouts: Layouts) =>
  Object.entries(layouts).map(([layoutId, declared]) => ({
    layoutId,
    description: layoutId,
    blocks: declared.map((block) => ({ content: { title: block.type }, ...block })),
  }));

async function fixture() {
  const suffix = crypto.randomUUID();
  const base = await createProjectFixture(`development-${suffix}`);
  const { db, project } = base;
  const projectId = project.id;

  const [ada] = await db
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
  await db.insert(member).values({
    id: `membership-ada-${suffix}`,
    organizationId: project.organizationId,
    userId: ada.id,
    role: "member",
    createdAt: new Date(),
  });

  const as = (who: typeof ada | null, headers: Record<string, string> = {}) => ({
    context: createRpcContext(db, who, headers),
  });
  const me = base.memberUser;
  const definitionSet = (definitions: Definition[], layouts: Layouts) => ({
    blocks: definitionsInput(definitions),
    layouts: layoutsInput(layouts),
    collections: [],
    homepage: null,
  });

  /** A release: the site's build syncing Live's definitions with the deploy token. */
  const release = async (definitions: Definition[], layouts: Layouts = { default: [] }) => {
    await syncDefinitionSet(db, project, definitionSet(definitions, layouts));
  };

  /** Dev mode syncing local code, with the member's session and `x-camox-draft: development`. */
  const devSync = (
    definitions: Definition[],
    layouts: Layouts = { default: [] },
    who: typeof ada = me,
  ) =>
    call(
      router.definitions.sync,
      {
        projectSlug: project.slug,
        autoCreate: true,
        definitionSet: definitionSet(definitions, layouts),
      },
      as(who, development),
    );

  const now = Date.now();
  const page = await db
    .insert(pages)
    .values({
      projectId,
      layoutId: "default",
      pathSegment: "",
      fullPath: "/",
      nickname: "Home",
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  const createBlock = (title: string, headers: Record<string, string> = {}) =>
    callSeedingLive(
      router.blocks.create,
      { pageId: page.id, type: "hero", content: { title } },
      as(me, headers),
    );
  const editTitle = (id: string, title: string, headers: Record<string, string>) =>
    call(router.blocks.updateContent, { id, content: { title } }, as(me, headers));
  const contentOf = async (id: string, headers: Record<string, string> = {}) =>
    (await call(router.blocks.get, { id }, as(me, headers))).block.content as Record<
      string,
      unknown
    >;
  const definitionNames = async (headers: Record<string, string> = {}) =>
    (await call(router.blockDefinitions.list, { projectId }, as(me, headers)))
      .map((definition) => definition.blockId)
      .sort();
  const developmentDrafts = () =>
    db
      .select()
      .from(drafts)
      .where(and(eq(drafts.projectId, projectId), eq(drafts.kind, "development")));
  const preview = () => call(router.drafts.previewPublish, { projectId }, as(me, development));
  const publish = async () =>
    call(router.drafts.publish, { projectId, token: (await preview()).token }, as(me, development));
  const discard = () => call(router.drafts.discard, { projectId }, as(me, development));

  return {
    ...base,
    ada,
    me,
    as,
    page,
    release,
    devSync,
    createBlock,
    editTitle,
    contentOf,
    definitionNames,
    developmentDrafts,
    preview,
    publish,
    discard,
  };
}

describe("development drafts", () => {
  it("are created by the first dev-mode sync after login, and later syncs replace their definitions without touching Live's", async () => {
    const f = await fixture();
    await f.release([{ blockId: "hero" }]);
    await expect(
      call(router.drafts.get, { projectId: f.project.id }, f.as(f.me, development)),
    ).rejects.toMatchObject({ code: NO_DEVELOPMENT_DRAFT_ERROR, status: 404 });

    const first = await f.devSync([{ blockId: "hero" }, { blockId: "card" }]);
    const second = await f.devSync([{ blockId: "card" }]);

    expect(first.draftCreated).toBe(true);
    expect(second.draftCreated).toBe(false);
    const [draft, ...others] = await f.developmentDrafts();
    expect(others).toEqual([]);
    expect(draft).toMatchObject({ createdBy: f.me.id });
    expect(await f.definitionNames(development)).toEqual(["card"]);
    expect(await f.definitionNames()).toEqual(["hero"]);
    // A regular draft reads Live's definitions.
    const regular = generateUuidv7();
    await f.createBlock("In a draft", {
      [DRAFT_HEADER]: regular,
      [DRAFT_CREATE_HEADER]: "1",
    });
    expect(await f.definitionNames(inDraft(regular))).toEqual(["hero"]);
  });

  it("refuse a session sync naming no development draft, and a release naming one", async () => {
    const f = await fixture();
    const definitionSet = { blocks: [], layouts: [], collections: [], homepage: null };
    await expect(
      call(
        router.definitions.sync,
        { projectSlug: f.project.slug, autoCreate: true, definitionSet },
        f.as(f.me),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      call(
        router.definitions.sync,
        {
          projectSlug: f.project.slug,
          deployToken: f.project.deployToken,
          autoCreate: false,
          definitionSet,
        },
        f.as(null, development),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await f.developmentDrafts()).toEqual([]);
  });

  it("read their content under the local definitions, with Live showing through where they change nothing", async () => {
    const f = await fixture();
    await f.release([{ blockId: "hero" }]);
    const block = await f.createBlock("From Live");
    const local = schema({
      subtitle: { type: "string", fieldType: "String", default: "From local code" },
    });
    await f.devSync([{ blockId: "hero", contentSchema: local }]);

    expect(await f.contentOf(block.id, development)).toEqual({
      title: "From Live",
      subtitle: "From local code",
    });
    expect(await f.contentOf(block.id)).toEqual({ title: "From Live" });

    // Writes need no create header: the development draft exists.
    await f.editTitle(block.id, "From development", development);
    expect((await f.contentOf(block.id, development)).title).toBe("From development");
    expect(await f.contentOf(block.id)).toEqual({ title: "From Live" });
  });

  it("are open to their owner only, and fail before the first sync with a hint to run the site locally", async () => {
    const f = await fixture();
    await f.release([{ blockId: "hero" }]);
    const block = await f.createBlock("Live");
    await f.devSync([{ blockId: "hero" }]);
    const [draft] = await f.developmentDrafts();

    await expect(
      call(router.blocks.get, { id: block.id }, f.as(f.ada, inDraft(draft.id))),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      call(router.blocks.get, { id: block.id }, f.as(f.ada, development)),
    ).rejects.toMatchObject({
      code: NO_DEVELOPMENT_DRAFT_ERROR,
      message: expect.stringContaining("run the site locally first"),
    });
    await expect(
      call(router.blocks.get, { id: block.id }, f.as(f.outsiderUser, development)),
    ).rejects.toMatchObject({ status: 403 });
    expect(await f.contentOf(block.id, development)).toEqual({ title: "Live" });
  });

  it("can't publish while their definitions differ from Live's, naming each one, and publish once a release ships them", async () => {
    const f = await fixture();
    await f.release([{ blockId: "hero" }, { blockId: "footer" }, { blockId: "banner" }]);
    const block = await f.createBlock("Live");
    const changed = schema({ subtitle: { type: "string", fieldType: "String" } });
    const local: Definition[] = [
      { blockId: "hero", contentSchema: changed },
      { blockId: "card" },
      // Titles don't count.
      { blockId: "footer", title: "Renamed footer" },
    ];
    await f.devSync(local);
    await f.editTitle(block.id, "From development", development);

    const { blockers } = await f.preview();
    expect(blockers.filter((blocker) => blocker.code === "definitionsDiffer")).toEqual([
      expect.objectContaining({
        label: 'Block "banner"',
        message: expect.stringContaining("not in your local code"),
      }),
      expect.objectContaining({
        label: 'Block "card"',
        message: expect.stringContaining("Only in your local code"),
      }),
      expect.objectContaining({
        entity: "definition",
        id: "block:hero",
        label: 'Block "hero"',
        message: expect.stringContaining("Differs from Live's"),
      }),
    ]);
    await expect(f.publish()).rejects.toMatchObject({ code: "PUBLISH_BLOCKED" });
    expect((await f.contentOf(block.id)).title).toBe("Live");

    await f.release(local);

    expect((await f.preview()).blockers).toEqual([]);
    await f.publish();
    expect((await f.contentOf(block.id)).title).toBe("From development");
  });

  it("are emptied by publishing or discarding, and keep their definitions", async () => {
    const f = await fixture();
    const local: Definition[] = [{ blockId: "hero" }];
    await f.release(local);
    const block = await f.createBlock("Live");
    await f.devSync(local);
    const [draft] = await f.developmentDrafts();

    await f.editTitle(block.id, "Published", development);
    expect(await f.publish()).toEqual({ empty: false, ended: null });
    expect((await f.contentOf(block.id)).title).toBe("Published");
    expect((await f.preview()).changes).toEqual([]);
    // A retry finds the draft empty and does nothing.
    expect(await f.publish()).toEqual({ empty: true, ended: null });

    await f.editTitle(block.id, "Discarded", development);
    expect(await f.discard()).toEqual({ ended: null });
    expect((await f.contentOf(block.id)).title).toBe("Published");
    expect((await f.contentOf(block.id, development)).title).toBe("Published");

    expect(await f.developmentDrafts()).toEqual([draft]);
    expect((await f.preview()).changes).toEqual([]);
    expect(await f.definitionNames(development)).toEqual(["hero"]);
  });

  it("hold the content dev mode seeds as draft rows, leaving Live untouched", async () => {
    const f = await fixture();
    await f.release([{ blockId: "hero" }]);
    await f.devSync([{ blockId: "hero" }, { blockId: "navbar", layoutOnly: true }], {
      default: [{ type: "navbar", slot: "before" }],
    });
    const [draft] = await f.developmentDrafts();

    const layoutIn = (headers: Record<string, string>) =>
      call(
        router.layouts.get,
        { projectSlug: f.project.slug, layoutId: "default" },
        f.as(f.me, headers),
      );
    expect((await layoutIn(development)).blocks.map((block) => block.type)).toEqual(["navbar"]);
    expect((await layoutIn({})).blocks).toEqual([]);
    const seeded = await f.db.select().from(blocks).where(eq(blocks.type, "navbar"));
    expect(seeded).toEqual([expect.objectContaining({ draftId: draft.id, layoutId: "default" })]);
  });

  it("apply the synced and no-longer-synced flips to draft rows", async () => {
    const f = await fixture();
    await f.release([{ blockId: "hero" }]);
    const first = await f.createBlock("First");
    const second = await f.createBlock("Second");

    await f.devSync([{ blockId: "hero", synced: true }]);

    const shared = (await f.contentOf(first.id, development)).title;
    expect(["First", "Second"]).toContain(shared);
    expect((await f.contentOf(second.id, development)).title).toBe(shared);
    expect((await f.contentOf(first.id)).title).toBe("First");
    expect((await f.contentOf(second.id)).title).toBe("Second");
    expect(await f.db.select().from(sharedContents).where(isNull(sharedContents.draftId))).toEqual(
      [],
    );

    await f.devSync([{ blockId: "hero", synced: false }]);

    expect((await f.contentOf(first.id, development)).title).toBe(shared);
    expect((await f.contentOf(second.id, development)).title).toBe(shared);
    await f.editTitle(second.id, "Own", development);
    expect((await f.contentOf(first.id, development)).title).toBe(shared);
    expect((await f.contentOf(second.id)).title).toBe("Second");
  });
});
