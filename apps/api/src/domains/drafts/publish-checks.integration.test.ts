import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createProjectFixture, createRpcContext, callSeedingLive } from "../../../test/fixtures";
import { router } from "../../router";
import { blockDefinitions, collectionDefinitions } from "../../schema";

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

const text = (value: string) => ({ type: "string", fieldType: "String" as const, title: value });

/**
 * A project with authors, and a byline block: an author reference, a list of co-authors, a
 * link and rich text.
 */
async function fixture() {
  const base = await createProjectFixture(`publish-checks-${crypto.randomUUID()}`);
  const projectId = base.project.id;
  const projectSlug = base.project.slug;
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
            properties: {
              name: text("Name"),
              mentor: {
                fieldType: "Reference",
                collectionId: "authors",
                title: "Mentor",
                anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
                default: null,
              },
            },
            required: ["name", "mentor"],
            additionalProperties: false,
          },
        },
      ],
    },
    { context: createRpcContext(base.db, null) },
  );
  await base.db.insert(blockDefinitions).values({
    projectId,
    blockId: "byline",
    title: "Byline",
    description: "",
    contentSchema: {
      type: "object",
      properties: {
        title: text("Title"),
        author: {
          fieldType: "Reference",
          collectionId: "authors",
          title: "Author",
          anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
          default: null,
        },
        coauthors: {
          fieldType: "ReferenceList",
          collectionId: "authors",
          title: "Co-authors",
          type: "array",
          items: { type: "string", format: "uuid" },
          default: [],
        },
        link: {
          fieldType: "Link",
          title: "Link",
          type: "object",
          properties: {
            type: { type: "string", enum: ["external", "page"] },
            text: { type: "string" },
            href: { type: "string" },
            pageId: { type: "string" },
          },
          default: { type: "external", text: "", href: "" },
        },
      },
    },
    createdAt: 1,
    updatedAt: 1,
  });
  // A card list whose cards need an author, and a synced banner that needs one too.
  const requiredAuthor = {
    fieldType: "Reference",
    collectionId: "authors",
    title: "Author",
    required: true,
    anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
    default: null,
  };
  await base.db.insert(blockDefinitions).values([
    {
      projectId,
      blockId: "cards",
      title: "Cards",
      description: "",
      contentSchema: {
        type: "object",
        properties: {
          cards: {
            fieldType: "Repeater",
            type: "array",
            items: {
              type: "object",
              properties: { label: text("Label"), author: requiredAuthor },
            },
          },
        },
      },
      createdAt: 1,
      updatedAt: 1,
    },
    {
      projectId,
      blockId: "banner",
      title: "Banner",
      description: "",
      synced: true,
      contentSchema: {
        type: "object",
        properties: { title: text("Title"), author: requiredAuthor },
      },
      createdAt: 1,
      updatedAt: 1,
    },
  ]);

  // Pages get a manual meta title, so their SEO (ADR 0012) stays out of these checks.
  const createPage = async (pathSegment: string, headers: Headers = {}) => {
    const { page } = await callSeedingLive(
      router.pages.create,
      { projectId, pathSegment, layoutId: base.layout.layoutId, nickname: pathSegment || "Home" },
      member(headers),
    );
    return callSeedingLive(
      router.pages.setSeo,
      { id: page.id, metaTitle: page.nickname },
      member(headers),
    );
  };
  const renamePage = (id: string, pathSegment: string, headers: Headers = {}) =>
    callSeedingLive(router.pages.update, { id, pathSegment }, member(headers));
  const listPages = (headers: Headers = {}) =>
    call(router.pages.list, { projectId }, member(headers));

  const createAuthor = (name: string, mentor: string | null = null, headers: Headers = {}) =>
    callSeedingLive(
      router.collectionDefinitions.createRecord,
      { projectSlug, collectionId: "authors", content: { name, mentor } },
      member(headers),
    );
  const deleteAuthor = (id: string, headers: Headers = {}) =>
    callSeedingLive(
      router.collectionDefinitions.deleteRecord,
      { projectSlug, collectionId: "authors", id },
      member(headers),
    );
  const listAuthors = (headers: Headers = {}) =>
    call(
      router.collectionDefinitions.listRecords,
      { projectSlug, collectionId: "authors" },
      member(headers),
    );
  const createByline = (pageId: string, content: Record<string, unknown>) =>
    callSeedingLive(router.blocks.create, { pageId, type: "byline", content }, member());
  const editByline = (id: string, content: Record<string, unknown>, headers: Headers = {}) =>
    callSeedingLive(router.blocks.updateContent, { id, content }, member(headers));
  const createBlock = (
    pageId: string,
    type: string,
    content: Record<string, unknown>,
    headers: Headers = {},
  ) => callSeedingLive(router.blocks.create, { pageId, type, content }, member(headers));
  const addCard = (blockId: string, content: Record<string, unknown>, headers: Headers = {}) =>
    callSeedingLive(
      router.repeatableItems.create,
      { blockId, fieldName: "cards", content },
      member(headers),
    );
  const deletePage = (id: string, headers: Headers = {}) =>
    callSeedingLive(router.pages.delete, { id }, member(headers));

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
    member,
    createPage,
    renamePage,
    listPages,
    deletePage,
    createAuthor,
    deleteAuthor,
    listAuthors,
    createByline,
    editByline,
    createBlock,
    addCard,
    preview,
    publish,
  };
}

describe("duplicate paths", () => {
  it("blocks publishing a page renamed in a draft to a path Live uses, and flags it in the draft", async () => {
    const f = await fixture();
    const about = await f.createPage("about");
    const team = await f.createPage("team");
    const draft = generateUuidv7();
    await f.renamePage(team.id, "about", startingDraft(draft));

    const flagged = (await f.listPages(inDraft(draft))).filter((page) => page.duplicatePath);
    expect(flagged.map((page) => page.id).toSorted()).toEqual([about.id, team.id].toSorted());
    expect((await f.listPages()).some((page) => page.duplicatePath)).toBe(false);

    const { blockers, warnings } = await f.preview(draft);
    expect(blockers).toEqual([
      expect.objectContaining({
        code: "duplicatePath",
        entity: "page",
        id: team.id,
        field: "path",
      }),
    ]);
    expect(warnings).toEqual([]);
    await expect(f.publish(draft)).rejects.toMatchObject({ code: "PUBLISH_BLOCKED" });

    await f.renamePage(team.id, "people", inDraft(draft));
    expect((await f.preview(draft)).blockers).toEqual([]);
  });
});

describe("duplicate record page values", () => {
  /** Author pages, found by the author's name. */
  const withAuthorPages = (f: Awaited<ReturnType<typeof fixture>>) =>
    call(
      router.layouts.sync,
      {
        projectSlug: f.project.slug,
        deployToken: f.project.deployToken,
        autoCreate: false,
        layouts: [
          { layoutId: f.layout.layoutId, kind: "curated", description: "", blocks: [] },
          {
            layoutId: "authors.$name",
            kind: "derived",
            description: "",
            blocks: [],
            recordPages: { collectionId: "authors", field: "name" },
          },
        ],
      },
      { context: createRpcContext(f.db, null) },
    );

  it("blocks two records sharing the value their record pages are found by, and flags them", async () => {
    const f = await fixture();
    await withAuthorPages(f);
    const ada = await f.createAuthor("ada");
    await f.createAuthor("grace");
    const draft = generateUuidv7();
    const twin = await f.createAuthor("ada", null, startingDraft(draft));

    const records = await f.listAuthors(inDraft(draft));
    expect(
      records.filter((record) => record.duplicatePageValue).map((record) => record.id),
    ).toEqual(expect.arrayContaining([ada.id, twin.id]));
    expect(records.filter((record) => record.duplicatePageValue)).toHaveLength(2);
    expect((await f.listAuthors()).some((record) => record.duplicatePageValue)).toBe(false);

    const { blockers, warnings } = await f.preview(draft);
    expect(blockers).toEqual([
      expect.objectContaining({
        code: "duplicateRecordPageValue",
        entity: "record",
        id: twin.id,
        field: "name",
        owner: expect.objectContaining({ kind: "collection", name: "authors" }),
      }),
    ]);
    expect(warnings).toEqual([]);
    await expect(f.publish(draft)).rejects.toMatchObject({ code: "PUBLISH_BLOCKED" });
  });

  it("only warns about records already sharing a value on Live", async () => {
    const f = await fixture();
    await withAuthorPages(f);
    const first = await f.createAuthor("ada");
    const second = await f.createAuthor("ada");
    const draft = generateUuidv7();
    await f.createAuthor("grace", null, startingDraft(draft));

    const { blockers, warnings } = await f.preview(draft);
    expect(blockers).toEqual([]);
    expect(warnings.map((warning) => warning.id).toSorted()).toEqual(
      [first.id, second.id].toSorted(),
    );
    expect(warnings[0]).toMatchObject({ code: "duplicateRecordPageValue", field: "name" });
  });

  it("checks nothing for a collection no layout renders as record pages", async () => {
    const f = await fixture();
    await f.createAuthor("ada");
    const draft = generateUuidv7();
    await f.createAuthor("ada", null, startingDraft(draft));

    expect((await f.preview(draft)).blockers).toEqual([]);
  });
});

describe("dangling references", () => {
  it("blocks deleting a record Live content points at, until the draft edits that content", async () => {
    const f = await fixture();
    const home = await f.createPage("");
    const ada = await f.createAuthor("Ada");
    const grace = await f.createAuthor("Grace");
    const byline = await f.createByline(home.id, { title: "By", author: ada.id });
    const pupil = await f.createAuthor("Pupil", ada.id);
    const listing = await f.createByline(home.id, { title: "With", coauthors: [grace.id, ada.id] });
    const draft = generateUuidv7();
    await f.deleteAuthor(ada.id, startingDraft(draft));

    const { blockers, warnings } = await f.preview(draft);
    const found = (problems: typeof blockers) =>
      problems.map(({ code, entity, id, field }) => ({ code, entity, id, field }));
    expect(found(blockers).toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        { code: "danglingReference", entity: "block", id: byline.id, field: "author" },
        { code: "danglingReference", entity: "record", id: pupil.id, field: "mentor" },
        { code: "danglingReference", entity: "block", id: listing.id, field: "coauthors" },
      ].toSorted((a, b) => a.id.localeCompare(b.id)),
    );
    expect(blockers.find((problem) => problem.id === pupil.id)).toMatchObject({
      label: "Pupil",
      owner: { kind: "collection", name: "authors" },
    });
    expect(warnings).toEqual([]);
    await expect(f.publish(draft)).rejects.toMatchObject({ code: "PUBLISH_BLOCKED" });

    await f.editByline(byline.id, { author: null }, inDraft(draft));
    await f.editByline(listing.id, { coauthors: [grace.id] }, inDraft(draft));
    await f.deleteAuthor(pupil.id, inDraft(draft));
    expect((await f.preview(draft)).blockers).toEqual([]);
    await f.publish(draft);
  });

  it("blocks content the draft changed that points at nothing", async () => {
    const f = await fixture();
    const home = await f.createPage("");
    const ada = await f.createAuthor("Ada");
    const byline = await f.createByline(home.id, { title: "By", author: ada.id });
    const draft = generateUuidv7();
    await f.editByline(byline.id, { title: "Written by" }, startingDraft(draft));
    // Live deletes the record after the draft copied the block.
    await f.deleteAuthor(ada.id);

    expect((await f.preview(draft)).blockers).toEqual([
      expect.objectContaining({ code: "danglingReference", id: byline.id, field: "author" }),
    ]);
  });

  it("only warns about a reference Live already left dangling", async () => {
    const f = await fixture();
    const home = await f.createPage("");
    const ada = await f.createAuthor("Ada");
    const byline = await f.createByline(home.id, { title: "By", author: ada.id });
    await f.deleteAuthor(ada.id);
    const draft = generateUuidv7();
    await f.createPage("about", startingDraft(draft));

    const { blockers, warnings } = await f.preview(draft);
    expect(blockers).toEqual([]);
    expect(warnings).toEqual([
      expect.objectContaining({ code: "danglingReference", id: byline.id, field: "author" }),
    ]);
  });

  it("blocks deleting a page that Live links point at", async () => {
    const f = await fixture();
    const home = await f.createPage("");
    const about = await f.createPage("about");
    const linking = await f.createByline(home.id, {
      title: "Hi",
      link: { type: "page", text: "About", pageId: about.id },
    });
    const draft = generateUuidv7();
    await f.deletePage(about.id, startingDraft(draft));

    expect((await f.preview(draft)).blockers).toEqual([
      expect.objectContaining({
        code: "danglingPageLink",
        entity: "block",
        id: linking.id,
        field: "link",
        owner: expect.objectContaining({ kind: "page", id: home.id }),
      }),
    ]);
  });

  it("leaves out content the draft deletes along with what it points at", async () => {
    const f = await fixture();
    const about = await f.createPage("about");
    await f.createByline(about.id, {
      title: "Self",
      link: { type: "page", text: "About", pageId: about.id },
    });
    const draft = generateUuidv7();
    await f.deletePage(about.id, startingDraft(draft));

    expect((await f.preview(draft)).blockers).toEqual([]);
  });
});

describe("empty required references", () => {
  it("blocks an empty one in a repeatable item and in synced shared content the draft changed", async () => {
    const f = await fixture();
    const home = await f.createPage("");
    const ada = await f.createAuthor("Ada");
    const cards = await f.createBlock(home.id, "cards", {});
    const banner = await f.createBlock(home.id, "banner", { title: "Hi", author: ada.id });
    const draft = generateUuidv7();
    const card = await f.addCard(cards.id, { label: "Card" }, startingDraft(draft));
    await f.editByline(banner.id, { author: null }, inDraft(draft));

    const { blockers, warnings } = await f.preview(draft);
    const found = blockers.map(({ code, entity, field }) => ({ code, entity, field }));
    expect(found.toSorted((a, b) => a.entity.localeCompare(b.entity))).toEqual([
      { code: "emptyRequiredReference", entity: "repeatableItem", field: "author" },
      { code: "emptyRequiredReference", entity: "sharedContent", field: "author" },
    ]);
    expect(blockers.find((problem) => problem.entity === "repeatableItem")?.id).toBe(card.id);
    expect(blockers.find((problem) => problem.entity === "sharedContent")).toMatchObject({
      owner: { kind: "syncedBlock", name: "banner" },
    });
    expect(warnings).toEqual([]);
    await expect(f.publish(draft)).rejects.toMatchObject({ code: "PUBLISH_BLOCKED" });
  });

  it("only warns about an empty one in an untouched Live item", async () => {
    const f = await fixture();
    const home = await f.createPage("");
    const cards = await f.createBlock(home.id, "cards", {});
    const card = await f.addCard(cards.id, { label: "Card" });
    const draft = generateUuidv7();
    await f.createPage("about", startingDraft(draft));

    const { blockers, warnings } = await f.preview(draft);
    expect(blockers).toEqual([]);
    expect(warnings).toEqual([
      expect.objectContaining({
        code: "emptyRequiredReference",
        entity: "repeatableItem",
        id: card.id,
        field: "author",
      }),
    ]);
  });
});

describe("values of the wrong kind", () => {
  it("blocks one in content the draft changed, and only warns about it in untouched Live content", async () => {
    const f = await fixture();
    const home = await f.createPage("");
    const edited = await f.createByline(home.id, { title: "Written by" });
    const untouched = await f.createByline(home.id, { title: "Also written by" });
    const ada = await f.createAuthor("Ada Lovelace");
    // A release shortens both fields: the values stored before are now the wrong kind.
    const [byline] = await f.db
      .select()
      .from(blockDefinitions)
      .where(eq(blockDefinitions.blockId, "byline"));
    const bylineSchema = byline.contentSchema as { properties: Record<string, object> };
    bylineSchema.properties.title = { ...bylineSchema.properties.title, maxLength: 5 };
    await f.db
      .update(blockDefinitions)
      .set({ contentSchema: bylineSchema })
      .where(eq(blockDefinitions.blockId, "byline"));
    const [authors] = await f.db.select().from(collectionDefinitions);
    const authorsSchema = authors.contentSchema as { properties: Record<string, object> };
    authorsSchema.properties.name = { ...authorsSchema.properties.name, maxLength: 3 };
    await f.db.update(collectionDefinitions).set({ contentSchema: authorsSchema });

    const draft = generateUuidv7();
    await f.editByline(edited.id, { author: ada.id }, startingDraft(draft));

    const { blockers, warnings } = await f.preview(draft);
    expect(blockers).toEqual([
      expect.objectContaining({
        code: "wrongKindValue",
        entity: "block",
        id: edited.id,
        field: "title",
      }),
    ]);
    const warned = warnings.map(({ code, id, field }) => ({ code, id, field }));
    expect(warned.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        { code: "wrongKindValue", id: untouched.id, field: "title" },
        { code: "wrongKindValue", id: ada.id, field: "name" },
      ].toSorted((a, b) => a.id.localeCompare(b.id)),
    );

    await f.editByline(edited.id, { title: "By" }, inDraft(draft));
    expect((await f.preview(draft)).blockers).toEqual([]);
  });
});
