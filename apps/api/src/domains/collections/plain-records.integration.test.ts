import { generateUuidv7 } from "@camox/api-contract/ids";
import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blockDefinitions, blocks, environments, files, pages } from "../../schema";
import { createBlock, getBlock } from "../blocks/service";
import { deleteFile, getFileUsageCount, updateFile } from "../files/service";
import { createRepeatableItem } from "../repeatable-items/service";
import type { ResolvedReference } from "./references";
import {
  createRecord,
  deleteRecord,
  editRecord,
  findRecordsByField,
  getCollectionRecord,
  getRecordUsageCount,
  syncCollectionDefinitions,
} from "./service";

const reference = (collectionId: string) => ({
  fieldType: "Reference" as const,
  collectionId,
  anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
  default: null,
});

const collections: Parameters<typeof syncCollectionDefinitions>[1]["definitions"] = [
  {
    collectionId: "authors",
    title: "Authors",
    description: "",
    label: "name",
    contentSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", fieldType: "String" as const },
        portrait: { type: "object", fieldType: "Image" as const },
      },
      required: ["name", "portrait"],
      additionalProperties: false as const,
    },
  },
  {
    collectionId: "articles",
    title: "Articles",
    description: "",
    label: "title",
    contentSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", fieldType: "String" as const },
        author: reference("authors"),
      },
      required: ["title", "author"],
      additionalProperties: false as const,
    },
  },
];

const imageSchema = {
  type: "object",
  properties: {
    image: {
      type: "object",
      fieldType: "Image",
      properties: { _fileId: { type: "number" } },
      required: ["_fileId"],
    },
  },
  required: ["image"],
  additionalProperties: false,
};

async function fixture() {
  const base = await createProjectFixture(`plain-records-${crypto.randomUUID()}`);
  const ctx = createServiceContext(base.db, base.memberUser);
  const page = await base.db
    .insert(pages)
    .values({
      projectId: base.project.id,
      environmentId: base.environment.id,
      layoutId: base.layout.id,
      pathSegment: "used-in",
      fullPath: "/used-in",
      nickname: "",
      createdAt: 1,
      updatedAt: 1,
      contentUpdatedAt: 1,
    })
    .returning()
    .get();
  await base.db.insert(blockDefinitions).values({
    projectId: base.project.id,
    environmentId: base.environment.id,
    blockId: "picture",
    title: "Picture",
    description: "",
    contentSchema: imageSchema,
    createdAt: 1,
    updatedAt: 1,
  });
  await base.db.insert(blockDefinitions).values({
    projectId: base.project.id,
    environmentId: base.environment.id,
    blockId: "byline",
    title: "Byline",
    description: "",
    contentSchema: {
      type: "object",
      properties: {
        author: reference("authors"),
        coauthors: {
          type: "array",
          fieldType: "Repeater",
          items: {
            type: "object",
            properties: { author: reference("authors") },
            required: ["author"],
          },
        },
      },
      required: ["author", "coauthors"],
      additionalProperties: false,
    },
    createdAt: 1,
    updatedAt: 1,
  });
  await runService(
    syncCollectionDefinitions(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: "test-deploy-token",
      autoCreate: false,
      definitions: collections,
    }),
  );
  const authors = { projectSlug: base.project.slug, collectionId: "authors" };
  const articles = { projectSlug: base.project.slug, collectionId: "articles" };
  const createAuthor = (name: string, portrait: unknown = null) =>
    runService(createRecord(ctx, { ...authors, content: { name, portrait } }));
  const createArticle = (title: string, author: string | null) =>
    runService(createRecord(ctx, { ...articles, content: { title, author } }));
  const byline = async (author: string | null) => {
    const block = await runService(
      createBlock(ctx, { pageId: page.id, type: "byline", content: { author } }),
    );
    const addCoauthor = (coauthor: string) =>
      runService(
        createRepeatableItem(ctx, {
          blockId: block.id,
          fieldName: "coauthors",
          content: { author: coauthor },
        }),
      );
    return Object.assign(
      async () =>
        (await runService(getBlock(ctx, { id: block.id, source: "draft" }))).block.references
          .author as ResolvedReference | null,
      { addCoauthor },
    );
  };
  /** A file row with the given id, so tests can pick ids that are prefixes of each other. */
  const insertFile = (id: string, mimeType = "image/png") =>
    base.db
      .insert(files)
      .values({
        id,
        projectId: base.project.id,
        environmentId: base.environment.id,
        url: `https://example.com/${id}.png`,
        alt: `File ${id}`,
        filename: `${id}.png`,
        mimeType,
        size: 1,
        blobId: `blob-${id}`,
        path: `blob-${id}`,
        createdAt: 1,
        updatedAt: 1,
      })
      .returning()
      .get();
  return {
    ...base,
    ctx,
    page,
    insertFile,
    authors,
    articles,
    createAuthor,
    createArticle,
    byline,
  };
}

const freshFileId = () => generateUuidv7();

describe("used in counts", () => {
  it("counts a file's uses exactly, never those of an id it is a prefix of", async () => {
    const f = await fixture();
    const short = await f.insertFile(freshFileId());
    // Stored as is, as content written before validation or by another tool could be.
    const long = await f.insertFile(`${short.id}7`);
    await f.db.insert(blocks).values({
      pageId: f.page.id,
      type: "picture",
      content: { image: { _fileId: long.id } },
      settings: {},
      position: "a0",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await runService(getFileUsageCount(f.ctx, { id: short.id }))).toEqual({ count: 0 });

    await runService(
      createBlock(f.ctx, {
        pageId: f.page.id,
        type: "picture",
        content: { image: { _fileId: short.id } },
      }),
    );
    expect(await runService(getFileUsageCount(f.ctx, { id: short.id }))).toEqual({ count: 1 });
  });

  it("counts a record's uses exactly, never those of an id it is a prefix of", async () => {
    const f = await fixture();
    const ada = await f.createAuthor("Ada");
    await f.db.insert(blocks).values({
      pageId: f.page.id,
      type: "byline",
      content: { author: `${ada.id}7` },
      settings: {},
      position: "a0",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await runService(getRecordUsageCount(f.ctx, { ...f.authors, id: ada.id }))).toEqual({
      count: 0,
    });
  });
});

describe("deleting a referenced record", () => {
  it("succeeds, and references to it read as empty", async () => {
    const f = await fixture();
    const ada = await f.createAuthor("Ada");
    const article = await f.createArticle("Hello", ada.id);
    const byline = await f.byline(ada.id);
    expect((await byline())?.content.name).toBe("Ada");

    await runService(deleteRecord(f.ctx, { ...f.authors, id: ada.id }));

    expect(await byline()).toBeNull();
    // The article still links the deleted author, and edits that leave the link alone save.
    const edited = await runService(
      editRecord(f.ctx, {
        ...f.articles,
        id: article.id,
        content: { title: "Hello again", author: ada.id },
      }),
    );
    expect(edited.content).toEqual({ title: "Hello again", author: ada.id });
    expect(
      await runService(getCollectionRecord(f.ctx, { ...f.articles, id: article.id })),
    ).toMatchObject({
      content: { title: "Hello again", author: ada.id },
    });
  });

  it("still refuses a new reference to a missing record", async () => {
    const f = await fixture();
    const ada = await f.createAuthor("Ada");
    const article = await f.createArticle("Hello", null);
    await runService(deleteRecord(f.ctx, { ...f.authors, id: ada.id }));

    await expect(
      runService(
        editRecord(f.ctx, {
          ...f.articles,
          id: article.id,
          content: { title: "Hello", author: ada.id },
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("used in counts for records", () => {
  it("counts the blocks, repeatable items and records referencing a record", async () => {
    const f = await fixture();
    const ada = await f.createAuthor("Ada");
    const grace = await f.createAuthor("Grace");
    const usage = async (id: string) =>
      (await runService(getRecordUsageCount(f.ctx, { ...f.authors, id }))).count;
    expect(await usage(ada.id)).toBe(0);

    const byline = await f.byline(ada.id);
    await byline.addCoauthor(ada.id);
    await f.createArticle("Hello", ada.id);
    expect(await usage(ada.id)).toBe(3);
    expect(await usage(grace.id)).toBe(0);
  });

  it("counts only uses in the record's own environment", async () => {
    const f = await fixture();
    const ada = await f.createAuthor("Ada");
    await f.createArticle("Hello", ada.id);
    // Another environment's content holding the same id is not a use of this record.
    const other = await f.db
      .insert(environments)
      .values({
        projectId: f.project.id,
        name: "staging",
        type: "development",
        createdAt: 1,
        updatedAt: 1,
      })
      .returning()
      .get();
    const elsewhere = await f.db
      .insert(pages)
      .values({
        projectId: f.project.id,
        environmentId: other.id,
        layoutId: f.layout.id,
        pathSegment: "elsewhere",
        fullPath: "/elsewhere",
        nickname: "",
        createdAt: 1,
        updatedAt: 1,
        contentUpdatedAt: 1,
      })
      .returning()
      .get();
    await f.db.insert(blocks).values({
      pageId: elsewhere.id,
      type: "byline",
      content: { author: ada.id },
      settings: {},
      position: "a0",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await runService(getRecordUsageCount(f.ctx, { ...f.authors, id: ada.id }))).toEqual({
      count: 1,
    });
  });
});

describe("files in records", () => {
  it("resolves a record's file on read, so file changes show without editing the record", async () => {
    const f = await fixture();
    const file = await f.insertFile(freshFileId());
    const ada = await f.createAuthor("Ada", { _fileId: file.id });
    expect(ada.content.portrait).toEqual({
      _fileId: file.id,
      url: file.url,
      alt: file.alt,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
    });

    await runService(
      updateFile(f.ctx, { projectId: f.project.id, id: file.id, alt: "Ada at her desk" }),
    );

    const read = await runService(getCollectionRecord(f.ctx, { ...f.authors, id: ada.id }));
    expect(read.content.portrait).toMatchObject({ _fileId: file.id, alt: "Ada at her desk" });
    const byline = await f.byline(ada.id);
    expect((await byline())?.content.portrait).toMatchObject({ alt: "Ada at her desk" });
  });

  it("refuses an asset that isn't a reference to a file", async () => {
    const f = await fixture();
    await expect(
      f.createAuthor("Ada", {
        url: "https://example.com/ada.png",
        alt: "",
        filename: "ada.png",
        mimeType: "image/png",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lets a file used by a record be deleted, after which the record reads it as empty", async () => {
    const f = await fixture();
    const file = await f.insertFile(freshFileId());
    const ada = await f.createAuthor("Ada", { _fileId: file.id });
    expect(await runService(getFileUsageCount(f.ctx, { id: file.id }))).toEqual({ count: 1 });

    await runService(deleteFile(f.ctx, { id: file.id }));

    const read = await runService(getCollectionRecord(f.ctx, { ...f.authors, id: ada.id }));
    expect(read.content.portrait).toBeNull();
    // An edit that leaves the deleted file in place still saves.
    const edited = await runService(
      editRecord(f.ctx, {
        ...f.authors,
        id: ada.id,
        content: { name: "Ada Lovelace", portrait: { _fileId: file.id } },
      }),
    );
    expect(edited.content).toEqual({ name: "Ada Lovelace", portrait: null });
  });
});

describe("records read their current content", () => {
  it("serves an edit to visitors right away, with no publish", async () => {
    const f = await fixture();
    const ada = await f.createAuthor("Ada");
    const article = await f.createArticle("Hello", null);
    await runService(
      editRecord(f.ctx, {
        ...f.articles,
        id: article.id,
        content: { title: "Hello", author: ada.id },
      }),
    );

    const visitor = createServiceContext(f.db, null);
    const [found] = await runService(
      findRecordsByField(visitor, { ...f.articles, field: "title", value: "Hello" }),
    );
    expect(found?.content).toEqual({ title: "Hello", author: ada.id });
    expect((found?.references.author as ResolvedReference | null)?.content.name).toBe("Ada");
  });
});
