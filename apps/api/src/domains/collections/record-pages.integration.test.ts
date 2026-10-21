import { generateUuidv7 } from "@camox/api-contract/ids";
import { describe, expect, it } from "vite-plus/test";

import { collection as articles } from "../../../../playground/src/collections/articles";
import { collection as authors } from "../../../../playground/src/collections/authors";
import {
  createProjectFixture,
  createServiceContext,
  seedLiveThrough,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { plainTextToLexicalState } from "../../lib/lexical-state";
import { runService } from "../../lib/run-service";
import {
  createRecord,
  editRecord,
  findRecordsByField,
  listRecordPageValues,
  recordMarkdown,
} from "./service";
import { collectionDefinitionInput } from "./validation";

const { id, ...articleDefinition } = articles._internal;
const serialized = JSON.parse(JSON.stringify({ ...articleDefinition, collectionId: id }));
// Without the playground's slug pattern, editors can store any value, as in a real project.
delete serialized.contentSchema.properties.slug.pattern;
const definition = collectionDefinitionInput.parse(serialized);
const { id: authorsId, ...authorDefinition } = authors._internal;
const serializedAuthors = JSON.parse(
  JSON.stringify({ ...authorDefinition, collectionId: authorsId }),
);
// Authors link back to an article here, to show that the second hop links nothing further.
serializedAuthors.contentSchema.properties.featured = {
  fieldType: "Reference",
  collectionId: "articles",
  anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
  default: null,
};
serializedAuthors.contentSchema.required.push("featured");
const authorsDefinition = collectionDefinitionInput.parse(serializedAuthors);
const article = { title: "Hello", slug: "hello", excerpt: "", body: "", cover: null, author: null };
const author = { name: "Ada", bio: "Writes about content.", portrait: null, featured: null };

async function fixture(suffix: string) {
  const base = await createProjectFixture(`record-pages-${suffix}`);
  const ctx = createServiceContext(base.db, base.memberUser);
  const publicCtx = createServiceContext(base.db, null);
  const scope = { projectUuid: base.project.uuid, collectionId: "articles" };
  await syncDefinitionSet(base.db, base.project, {
    collections: [definition, authorsDefinition],
  });
  // Record writes reach Live by publishing a throwaway draft (ADR 0009).
  const live = <A>(run: Parameters<typeof seedLiveThrough<A>>[2]) =>
    seedLiveThrough(ctx, base.project.id, run);
  const create = (content: Record<string, unknown>) =>
    live((_draft, c) => createRecord(c, { ...scope, content: { ...article, ...content } }));
  const edit = (record: { id: string }, content: Record<string, unknown>) =>
    live((_draft, c) =>
      editRecord(c, { ...scope, id: record.id, content: { ...article, ...content } }),
    );
  const find = (value: string, context = publicCtx) =>
    runService(findRecordsByField(context, { ...scope, field: "slug", value }));
  const list = (context = publicCtx) =>
    runService(listRecordPageValues(context, { ...scope, field: "slug" }));
  const createAuthor = (content: Record<string, unknown>) =>
    live((_draft, c) =>
      createRecord(c, { ...scope, collectionId: "authors", content: { ...author, ...content } }),
    );
  return { ...base, ctx, publicCtx, scope, create, edit, find, list, createAuthor };
}

describe("finding the records a record page renders", () => {
  it("matches the record's current values, for visitors and editors alike", async () => {
    const f = await fixture("current");
    const record = await f.create({ title: "First title", slug: "old-slug" });
    const edited = await f.edit(record, { title: "Edited title", slug: "new-slug" });

    const expected = [
      {
        id: record.id,
        content: { ...article, title: "Edited title", slug: "new-slug" },
        updatedAt: edited.updatedAt,
        references: { author: null },
      },
    ];
    expect(await f.find("new-slug")).toEqual(expected);
    expect(await f.find("new-slug", f.ctx)).toEqual(expected);
    expect(await f.find("old-slug")).toEqual([]);
  });

  it("resolves the record's references as the first hop", async () => {
    const f = await fixture("references");
    const other = await f.create({ title: "Other", slug: "other" });
    const ada = await f.createAuthor({ featured: other.id });
    await f.create({ author: ada.id });

    const [found] = await f.find("hello");
    expect(found.references.author).toMatchObject({
      id: ada.id,
      collectionId: "authors",
      label: "Ada",
      content: { ...author, featured: other.id },
    });
    // The author is the second hop: its own reference stays an unresolved id.
    expect(found.references.author).not.toHaveProperty("references");
  });

  it("compares the plain text of values stored as rich text", async () => {
    const f = await fixture("rich-text");
    const record = await f.create({ slug: plainTextToLexicalState("rich-slug") });
    expect(await f.find("rich-slug")).toMatchObject([{ id: record.id }]);
  });

  it("returns every record sharing a value, so the caller can report the ambiguity", async () => {
    const f = await fixture("ambiguous");
    const first = await f.create({ title: "First" });
    const second = await f.create({ title: "Second" });
    const ids = (await f.find("hello")).map((record) => record.id);
    expect(ids.toSorted()).toEqual([first.id, second.id].toSorted());
  });

  it("never matches an empty value or one containing a slash", async () => {
    const f = await fixture("unroutable");
    await f.create({ slug: "" });
    await f.create({ slug: "a/b" });
    expect(await f.find("")).toEqual([]);
    expect(await f.find("a/b")).toEqual([]);
  });

  it("rejects fields that aren't String fields", async () => {
    const f = await fixture("string-only");
    await expect(
      runService(findRecordsByField(f.ctx, { ...f.scope, field: "cover", value: "hello" })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("never returns a development draft's record outside it, nor another project's", async () => {
    const f = await fixture("isolation");
    const live = await f.create({});
    const devCtx = { ...f.ctx, draft: { development: true as const } };
    await syncDefinitionSet(
      f.db,
      f.project,
      { collections: [definition, authorsDefinition] },
      { as: f.memberUser },
    );
    // Live's record shows through in the development draft.
    expect((await f.find("hello", devCtx)).map((record) => record.id)).toEqual([live.id]);
    const drafted = await runService(
      createRecord(devCtx, { ...f.scope, content: { ...article, slug: "drafted" } }),
    );
    expect((await f.find("drafted", devCtx)).map((record) => record.id)).toEqual([drafted.id]);
    expect(await f.find("drafted")).toEqual([]);
    const other = await fixture("isolation-other");
    expect(await other.find("hello")).toEqual([]);
  });
});

describe("listing the records that can have a page", () => {
  it("lists each record's current value", async () => {
    const f = await fixture("list-current");
    const record = await f.create({ slug: "old-slug" });
    await f.edit(record, { slug: "new-slug" });
    const rich = await f.create({ slug: plainTextToLexicalState("rich-slug") });

    expect((await f.list()).toSorted((a, b) => a.value.localeCompare(b.value))).toEqual([
      { id: record.id, value: "new-slug", label: "Hello" },
      { id: rich.id, value: "rich-slug", label: "Hello" },
    ]);
  });

  it("names each record by its Label, as Live reads it for visitors", async () => {
    const f = await fixture("list-label");
    const record = await f.create({ title: "Live title", slug: "labelled" });
    const devCtx = { ...f.ctx, draft: { development: true as const } };
    await syncDefinitionSet(
      f.db,
      f.project,
      { collections: [definition, authorsDefinition] },
      { as: f.memberUser },
    );
    await runService(
      editRecord(devCtx, {
        ...f.scope,
        id: record.id,
        content: { ...article, title: "Drafted title", slug: "labelled" },
      }),
    );

    expect(await f.list()).toEqual([{ id: record.id, value: "labelled", label: "Live title" }]);
    expect(await f.list(devCtx)).toEqual([
      { id: record.id, value: "labelled", label: "Drafted title" },
    ]);
  });

  it("leaves out empty values and values containing a slash, and keeps shared values", async () => {
    const f = await fixture("list-unroutable");
    await f.create({ slug: "" });
    await f.create({ slug: "a/b" });
    const first = await f.create({ slug: "twin" });
    const second = await f.create({ slug: "twin" });
    expect((await f.list()).map((entry) => entry.id).toSorted()).toEqual(
      [first.id, second.id].toSorted(),
    );
  });

  it("returns nothing for an empty collection", async () => {
    const f = await fixture("list-empty");
    expect(await f.list()).toEqual([]);
  });

  it("stays in its draft and project", async () => {
    const f = await fixture("list-isolation");
    const live = await f.create({});
    const devCtx = { ...f.ctx, draft: { development: true as const } };
    await syncDefinitionSet(
      f.db,
      f.project,
      { collections: [definition, authorsDefinition] },
      { as: f.memberUser },
    );
    // Live's record shows through in the development draft; the draft's own stays out of Live.
    const drafted = await runService(
      createRecord(devCtx, { ...f.scope, content: { ...article, slug: "drafted" } }),
    );
    expect((await f.list(devCtx)).toSorted((a, b) => a.value.localeCompare(b.value))).toEqual([
      { id: drafted.id, value: "drafted", label: "Hello" },
      { id: live.id, value: "hello", label: "Hello" },
    ]);
    expect(await f.list()).toEqual([{ id: live.id, value: "hello", label: "Hello" }]);
    const other = await fixture("list-isolation-other");
    expect(await other.list()).toEqual([]);
  });
});

describe("the Markdown of a record page's record", () => {
  it("fills the layout's Markdown builder with the record's current fields and its author", async () => {
    const f = await fixture("markdown");
    const ada = await f.createAuthor({});
    const record = await f.create({
      title: "Hello",
      body: plainTextToLexicalState("Rich body"),
      author: ada.id,
    });
    const markdown = (toMarkdown: string[], context = f.publicCtx) =>
      runService(recordMarkdown(context, { ...f.scope, id: record.id, toMarkdown }));

    expect(
      await markdown(["# {{title}}", "By {{author.name}}", "{{body}}", "{{excerpt}}", "Fixed"]),
    ).toBe("# Hello\n\nBy Ada\n\nRich body\n\nFixed");
    await f.edit(record, { title: "Edited", author: ada.id });
    expect(await markdown(["# {{title}}"], f.ctx)).toBe("# Edited");
    await expect(
      runService(recordMarkdown(f.publicCtx, { ...f.scope, id: generateUuidv7(), toMarkdown: [] })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
