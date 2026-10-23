import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  seedLive,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { router } from "../../router";
import { files } from "../../schema";

type Headers = Record<string, string>;
/** Headers naming a draft, creating it when missing. */
const startingDraft = (id: string): Headers => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
/** Headers naming an existing draft. */
const inDraft = (id: string): Headers => ({ [DRAFT_HEADER]: id });

const text = (title: string) => ({ type: "string", fieldType: "String" as const, title });

/** Rich text as the editor stores it: a paragraph of a plain run and a bold one. */
const richText = (plain: string, bold: string) =>
  JSON.stringify({
    root: {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", text: plain, format: 0 },
            { type: "text", text: bold, format: 1 },
          ],
        },
      ],
    },
  });

/** A project with a page and a hero block of a few titled fields. */
async function fixture() {
  const base = await createProjectFixture(`conflict-fields-${crypto.randomUUID()}`);
  const projectId = base.project.id;
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(base.db, base.memberUser, headers),
  });
  await syncDefinitionSet(base.db, base.project, {
    collections: [
      {
        collectionId: "authors",
        title: "Authors",
        description: "",
        toTitle: "{{name}}",
        toDescription: null,
        contentSchema: {
          type: "object",
          properties: { name: text("Name") },
          required: ["name"],
          additionalProperties: false,
        },
      },
    ],
    blocks: [
      {
        blockId: "hero",
        title: "Hero",
        description: "Hero",
        contentSchema: {
          type: "object",
          properties: {
            title: text("Title"),
            subtitle: text("Subtitle"),
            author: {
              fieldType: "Reference",
              collectionId: "authors",
              title: "Author",
              anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
              default: null,
            },
            image: {
              fieldType: "Image",
              title: "Image",
              type: "object",
              properties: { _fileId: { type: "string" } },
            },
            links: {
              fieldType: "Repeater",
              title: "Links",
              type: "array",
              items: { type: "object", properties: { label: text("Label") } },
            },
          },
          toMarkdown: ["# {{title}}"],
        },
      },
    ],
  });
  const { page } = await callSeedingLive(
    router.pages.create,
    { projectId, pathSegment: "", layoutId: base.layout.layoutId, nickname: "Home" },
    member(),
  );

  const createHero = (content: Record<string, unknown>) =>
    callSeedingLive(router.blocks.create, { pageId: page.id, type: "hero", content }, member());
  const createAuthor = (name: string) =>
    callSeedingLive(
      router.collectionDefinitions.createRecord,
      { projectUuid: base.project.uuid, collectionId: "authors", content: { name } },
      member(),
    );
  const createImage = (filename: string) =>
    seedLive(base.db, files, {
      projectId,
      url: `https://example.com/${filename}`,
      filename,
      alt: filename,
      mimeType: "image/png",
      size: 1,
      blobId: filename,
      path: filename,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  const addLink = (blockId: string, label: string) =>
    callSeedingLive(
      router.repeatableItems.create,
      { blockId, fieldName: "links", content: { label } },
      member(),
    );
  const editLink = (id: string, label: string, headers: Headers) =>
    call(router.repeatableItems.updateContent, { id, content: { label } }, member(headers));
  const renameAuthor = (id: string, name: string, headers: Headers) =>
    call(
      router.collectionDefinitions.editRecord,
      { projectUuid: base.project.uuid, collectionId: "authors", id, content: { name } },
      member(headers),
    );
  const editBlock = (id: string, content: Record<string, unknown>, headers: Headers = {}) =>
    callSeedingLive(router.blocks.updateContent, { id, content }, member(headers));
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
    createAuthor,
    createImage,
    createHero,
    addLink,
    editLink,
    renameAuthor,
    editBlock,
    preview,
    publishedOnLive,
  };
}

describe("a conflict's fields", () => {
  it("lists the fields where Live's version and the draft's copy differ, by their titles", async () => {
    const { createHero, editBlock, preview, publishedOnLive } = await fixture();
    const hero = await createHero({ title: "Welcome", subtitle: "Hello" });
    const draft = generateUuidv7();
    await editBlock(hero.id, { title: "Welcome home" }, startingDraft(draft));
    await publishedOnLive((headers) => editBlock(hero.id, { title: "Welcome back" }, headers));

    const { conflicts } = await preview(draft);

    expect(conflicts).toEqual([
      expect.objectContaining({
        id: hero.id,
        fields: [{ field: "Title", live: "Welcome back", draft: "Welcome home" }],
        moreFields: 0,
      }),
    ]);
  });

  it("shows rich text flattened, references by their record's label, and images by their filename", async () => {
    const { createAuthor, createHero, createImage, editBlock, preview, publishedOnLive } =
      await fixture();
    const ana = await createAuthor("Ana");
    const leo = await createAuthor("Léo");
    const sunrise = await createImage("sunrise.png");
    const sunset = await createImage("sunset.png");
    const hero = await createHero({ title: "Welcome" });
    const draft = generateUuidv7();
    await editBlock(
      hero.id,
      { title: richText("Hello ", "world"), author: ana.id, image: { _fileId: sunrise.id } },
      startingDraft(draft),
    );
    await publishedOnLive((headers) =>
      editBlock(
        hero.id,
        { title: richText("Bye ", "now"), author: leo.id, image: { _fileId: sunset.id } },
        headers,
      ),
    );

    const [conflict] = (await preview(draft)).conflicts;

    expect(conflict.fields).toEqual([
      { field: "Title", live: "Bye now", draft: "Hello world" },
      { field: "Author", live: "Léo", draft: "Ana" },
      { field: "Image", live: "sunset.png", draft: "sunrise.png" },
    ]);
  });

  it("lists at most three fields, in the definition's order, and counts the rest", async () => {
    const { createAuthor, createHero, createImage, editBlock, preview, publishedOnLive } =
      await fixture();
    const ana = await createAuthor("Ana");
    const sunrise = await createImage("sunrise.png");
    const hero = await createHero({ title: "Welcome" });
    const draft = generateUuidv7();
    await editBlock(
      hero.id,
      { title: "Mine", subtitle: "Mine", author: ana.id, image: { _fileId: sunrise.id } },
      startingDraft(draft),
    );
    await publishedOnLive((headers) => editBlock(hero.id, { title: "Theirs" }, headers));

    const [conflict] = (await preview(draft)).conflicts;

    expect(conflict.fields.map((field) => field.field)).toEqual(["Title", "Subtitle", "Author"]);
    expect(conflict.moreFields).toBe(1);
  });

  it("cuts a long value short, on one line", async () => {
    const { createHero, editBlock, preview, publishedOnLive } = await fixture();
    const hero = await createHero({ title: "Welcome" });
    const long = Array.from({ length: 100 }, (_, index) => `Line ${index}`).join("\n");
    const draft = generateUuidv7();
    await editBlock(hero.id, { title: long }, startingDraft(draft));
    await publishedOnLive((headers) => editBlock(hero.id, { title: "Theirs" }, headers));

    const [field] = (await preview(draft)).conflicts[0].fields;

    expect(field.draft.startsWith("Line 0 Line 1 Line 2")).toBe(true);
    expect(field.draft.endsWith("…")).toBe(true);
    expect(field.draft.length).toBeLessThan(long.length);
  });

  it("lists no fields when Live deleted the entity", async () => {
    const { createHero, editBlock, member, preview, publishedOnLive } = await fixture();
    const hero = await createHero({ title: "Welcome" });
    const draft = generateUuidv7();
    await editBlock(hero.id, { title: "Mine" }, startingDraft(draft));
    await publishedOnLive((headers) =>
      call(router.blocks.delete, { id: hero.id }, member(headers)),
    );

    const { conflicts } = await preview(draft);

    expect(conflicts).toEqual([
      expect.objectContaining({ id: hero.id, liveVersion: null, fields: [], moreFields: 0 }),
    ]);
  });

  it("lists no fields when the draft deletes the entity", async () => {
    const { createHero, editBlock, member, preview, publishedOnLive } = await fixture();
    const hero = await createHero({ title: "Welcome" });
    const draft = generateUuidv7();
    await call(router.blocks.delete, { id: hero.id }, member(startingDraft(draft)));
    await publishedOnLive((headers) => editBlock(hero.id, { title: "Theirs" }, headers));

    const { conflicts } = await preview(draft);

    expect(conflicts).toEqual([
      expect.objectContaining({ id: hero.id, fields: [], moreFields: 0 }),
    ]);
  });

  it("lists the fields of a repeatable item, by the titles its repeater gives them", async () => {
    const { addLink, createHero, editLink, preview, publishedOnLive } = await fixture();
    const hero = await createHero({ title: "Welcome" });
    const item = await addLink(hero.id, "Docs");
    const draft = generateUuidv7();
    await editLink(item.id, "Guides", startingDraft(draft));
    await publishedOnLive((headers) => editLink(item.id, "Manual", headers));

    const { conflicts } = await preview(draft);

    expect(conflicts).toEqual([
      expect.objectContaining({
        entity: "repeatableItem",
        fields: [{ field: "Label", live: "Manual", draft: "Guides" }],
      }),
    ]);
  });

  it("lists the fields of a record, by its collection's titles", async () => {
    const { createAuthor, preview, publishedOnLive, renameAuthor } = await fixture();
    const ana = await createAuthor("Ana");
    const draft = generateUuidv7();
    await renameAuthor(ana.id, "Anna", startingDraft(draft));
    await publishedOnLive((headers) => renameAuthor(ana.id, "Ana B.", headers));

    const { conflicts } = await preview(draft);

    expect(conflicts).toEqual([
      expect.objectContaining({
        entity: "record",
        fields: [{ field: "Name", live: "Ana B.", draft: "Anna" }],
      }),
    ]);
  });
});
