import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { createProjectFixture, createRpcContext, callSeedingLive } from "../../../test/fixtures";
import { router } from "../../router";
import { blockDefinitions, pages } from "../../schema";
import type { ResolvedReference } from "../content/reader";

const { broadcastInvalidation, broadcastDraftEnded } = vi.hoisted(() => {
  // Modules loaded by earlier test files would keep the real broadcaster.
  vi.resetModules();
  return { broadcastInvalidation: vi.fn(), broadcastDraftEnded: vi.fn() };
});
vi.mock("../../lib/broadcast-invalidation", () => ({ broadcastInvalidation, broadcastDraftEnded }));

type Headers = Record<string, string>;
/** Headers naming a draft, creating it when missing. */
const startingDraft = (id: string): Headers => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
/** Headers naming an existing draft. */
const inDraft = (id: string): Headers => ({ [DRAFT_HEADER]: id });

const reference = (collectionId: string) => ({
  fieldType: "Reference" as const,
  collectionId,
  anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
  default: null,
});

const articleSchema = {
  type: "object" as const,
  properties: { title: { type: "string", fieldType: "String" as const } },
  required: ["title"],
  additionalProperties: false as const,
};

/** Runs `run` with the clock at `time`, so records get known publish times. */
async function at<T>(time: number, run: () => Promise<T>) {
  const clock = vi.spyOn(Date, "now").mockReturnValue(time);
  try {
    return await run();
  } finally {
    clock.mockRestore();
  }
}

/**
 * Authors and articles, and a page with one block: a byline referencing an author and a
 * query-backed list of the three most recently published articles.
 */
async function fixture() {
  const base = await createProjectFixture(`record-drafts-${crypto.randomUUID()}`);
  const projectSlug = base.project.slug;
  const projectId = base.project.id;
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(base.db, base.memberUser, headers),
  });
  await call(
    router.collectionDefinitions.sync,
    {
      projectSlug,
      deployToken: base.project.deployToken,
      autoCreate: false,
      definitions: [
        {
          collectionId: "authors",
          title: "Authors",
          description: "",
          label: "name",
          contentSchema: {
            type: "object",
            properties: { name: { type: "string", fieldType: "String" } },
            required: ["name"],
            additionalProperties: false,
          },
        },
        {
          collectionId: "articles",
          title: "Articles",
          description: "",
          label: "title",
          contentSchema: articleSchema,
        },
      ],
    },
    { context: createRpcContext(base.db, null) },
  );
  const page = await base.db
    .insert(pages)
    .values({
      projectId,
      layoutId: base.layout.layoutId,
      pathSegment: "",
      fullPath: "/",
      nickname: "Home",
      createdAt: 1,
      updatedAt: 1,
      contentUpdatedAt: 1,
    })
    .returning()
    .get();
  await base.db.insert(blockDefinitions).values({
    projectId,
    blockId: "byline",
    title: "Byline",
    description: "",
    contentSchema: {
      type: "object",
      properties: {
        author: reference("authors"),
        recent: {
          type: "array",
          items: { type: "string", format: "uuid" },
          fieldType: "ReferenceList",
          collectionId: "articles",
          title: "Recent",
          query: { orderBy: { publishedAt: "desc" }, limit: 3 },
          referenceSchema: articleSchema,
        },
      },
      required: ["author", "recent"],
      additionalProperties: false,
    },
    createdAt: 1,
    updatedAt: 1,
  });

  const authors = { projectSlug, collectionId: "authors" };
  const articles = { projectSlug, collectionId: "articles" };
  const createAuthor = (name: string, headers: Headers = {}) =>
    callSeedingLive(
      router.collectionDefinitions.createRecord,
      { ...authors, content: { name } },
      member(headers),
    );
  const renameAuthor = (id: string, name: string, headers: Headers = {}) =>
    callSeedingLive(
      router.collectionDefinitions.editRecord,
      { ...authors, id, content: { name } },
      member(headers),
    );
  const deleteAuthor = (id: string, headers: Headers = {}) =>
    callSeedingLive(router.collectionDefinitions.deleteRecord, { ...authors, id }, member(headers));
  const authorNames = async (headers: Headers = {}) =>
    (await call(router.collectionDefinitions.listRecords, authors, member(headers)))
      .map((record) => record.label)
      .sort();
  const createArticle = (title: string, headers: Headers = {}) =>
    callSeedingLive(
      router.collectionDefinitions.createRecord,
      { ...articles, content: { title } },
      member(headers),
    );
  const retitleArticle = (id: string, title: string, headers: Headers = {}) =>
    callSeedingLive(
      router.collectionDefinitions.editRecord,
      { ...articles, id, content: { title } },
      member(headers),
    );

  const createByline = (author: string | null, headers: Headers = {}) =>
    callSeedingLive(
      router.blocks.create,
      { pageId: page.id, type: "byline", content: { author } },
      member(headers),
    );
  const references = async (blockId: string, headers: Headers = {}) =>
    (await call(router.blocks.get, { id: blockId }, member(headers))).block.references;
  const bylineAuthor = async (blockId: string, headers: Headers = {}) =>
    ((await references(blockId, headers)).author as ResolvedReference | null)?.label ?? null;
  const recentTitles = async (blockId: string, headers: Headers = {}) =>
    ((await references(blockId, headers)).recent as ResolvedReference[]).map((r) => r.label);
  const usageCount = async (id: string, headers: Headers = {}) =>
    (
      await call(
        router.collectionDefinitions.getRecordUsageCount,
        { ...authors, id },
        member(headers),
      )
    ).count;

  const preview = (draftId: string) =>
    call(router.drafts.previewPublish, { projectId }, member(inDraft(draftId)));
  const publish = async (draftId: string) =>
    call(
      router.drafts.publish,
      { projectId, token: (await preview(draftId)).token },
      member(inDraft(draftId)),
    );

  return {
    ...base,
    createAuthor,
    renameAuthor,
    deleteAuthor,
    authorNames,
    createArticle,
    retitleArticle,
    createByline,
    bylineAuthor,
    recentTitles,
    usageCount,
    preview,
    publish,
  };
}

describe("collection records in a draft", () => {
  it("creates, edits and deletes records invisibly to Live and other drafts until published", async () => {
    const f = await fixture();
    const ada = await f.createAuthor("Ada");
    const grace = await f.createAuthor("Grace");
    const draft = generateUuidv7();
    const other = generateUuidv7();
    await f.createAuthor("Linus", startingDraft(other));

    await f.renameAuthor(ada.id, "Ada Lovelace", startingDraft(draft));
    await f.deleteAuthor(grace.id, inDraft(draft));
    await f.createAuthor("Barbara", inDraft(draft));

    expect(await f.authorNames(inDraft(draft))).toEqual(["Ada Lovelace", "Barbara"]);
    expect(await f.authorNames()).toEqual(["Ada", "Grace"]);
    expect(await f.authorNames(inDraft(other))).toEqual(["Ada", "Grace", "Linus"]);

    await f.publish(draft);

    expect(await f.authorNames()).toEqual(["Ada Lovelace", "Barbara"]);
    expect(await f.authorNames(inDraft(other))).toEqual(["Ada Lovelace", "Barbara", "Linus"]);
  });

  it("finds a record the draft created only in that draft", async () => {
    const f = await fixture();
    const draft = generateUuidv7();
    const barbara = await f.createAuthor("Barbara", startingDraft(draft));
    const get = (headers: Headers = {}) =>
      call(
        router.collectionDefinitions.getRecord,
        { projectSlug: f.project.slug, collectionId: "authors", id: barbara.id },
        { context: createRpcContext(f.db, f.memberUser, headers) },
      );

    expect((await get(inDraft(draft))).content).toEqual({ name: "Barbara" });
    await expect(get()).rejects.toMatchObject({ status: 404 });
  });
});

describe("references in a draft", () => {
  it("show the draft's version of a record in that draft, and Live's elsewhere", async () => {
    const f = await fixture();
    const ada = await f.createAuthor("Ada");
    const byline = await f.createByline(ada.id);
    const draft = generateUuidv7();

    await f.renameAuthor(ada.id, "Ada Lovelace", startingDraft(draft));

    expect(await f.bylineAuthor(byline.id, inDraft(draft))).toBe("Ada Lovelace");
    expect(await f.bylineAuthor(byline.id)).toBe("Ada");
  });

  it("leave out a record the draft deleted, and accept one only the draft holds", async () => {
    const f = await fixture();
    const ada = await f.createAuthor("Ada");
    const byline = await f.createByline(ada.id);
    const draft = generateUuidv7();
    await f.deleteAuthor(ada.id, startingDraft(draft));
    expect(await f.bylineAuthor(byline.id, inDraft(draft))).toBeNull();

    const barbara = await f.createAuthor("Barbara", inDraft(draft));
    const drafted = await f.createByline(barbara.id, inDraft(draft));

    expect(await f.bylineAuthor(drafted.id, inDraft(draft))).toBe("Barbara");
    await expect(f.createByline(barbara.id)).rejects.toMatchObject({ status: 400 });
  });

  it("count a record's uses as the draft sees them", async () => {
    const f = await fixture();
    const ada = await f.createAuthor("Ada");
    await f.createByline(ada.id);
    const draft = generateUuidv7();

    await f.createByline(ada.id, startingDraft(draft));
    await f.createByline(ada.id, inDraft(draft));

    expect(await f.usageCount(ada.id, inDraft(draft))).toBe(3);
    expect(await f.usageCount(ada.id)).toBe(1);
  });
});

describe("query-backed lists in a draft", () => {
  it("keep an old record's place when it's edited and republished, and sort the draft's new records as newest", async () => {
    const f = await fixture();
    const byline = await f.createByline(null);
    const oldest = await at(1000, () => f.createArticle("Oldest"));
    await at(2000, () => f.createArticle("Middle"));
    await at(3000, () => f.createArticle("Newest"));
    expect(await f.recentTitles(byline.id)).toEqual(["Newest", "Middle", "Oldest"]);

    const edit = generateUuidv7();
    await at(4000, () => f.retitleArticle(oldest.id, "Oldest, edited", startingDraft(edit)));
    await at(5000, () => f.publish(edit));
    expect(await f.recentTitles(byline.id)).toEqual(["Newest", "Middle", "Oldest, edited"]);

    const draft = generateUuidv7();
    await at(6000, () => f.createArticle("Drafted", startingDraft(draft)));
    // Published after the draft's record was created, before the draft is published.
    await at(7000, () => f.createArticle("Later"));
    expect(await f.recentTitles(byline.id, inDraft(draft))).toEqual(["Drafted", "Later", "Newest"]);
    expect(await f.recentTitles(byline.id)).toEqual(["Later", "Newest", "Middle"]);

    await at(8000, () => f.publish(draft));
    expect(await f.recentTitles(byline.id)).toEqual(["Drafted", "Later", "Newest"]);
  });
});

describe("reviewing a draft's record changes", () => {
  it("lists each record change under its collection", async () => {
    const f = await fixture();
    const ada = await f.createAuthor("Ada");
    const draft = generateUuidv7();
    await f.renameAuthor(ada.id, "Ada Lovelace", startingDraft(draft));
    const article = await f.createArticle("Hello", inDraft(draft));

    const { changes } = await f.preview(draft);

    expect(changes).toEqual(
      expect.arrayContaining([
        {
          entity: "record",
          id: ada.id,
          label: "Ada Lovelace",
          owner: { kind: "collection", name: "authors", title: "Authors" },
          change: "changed",
        },
        {
          entity: "record",
          id: article.id,
          label: "Hello",
          owner: { kind: "collection", name: "articles", title: "Articles" },
          change: "created",
        },
      ]),
    );
  });
});
