import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { collection as articles } from "../../../../playground/src/collections/articles";
import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { plainTextToLexicalState } from "../../lib/lexical-state";
import { runService } from "../../lib/run-service";
import { blockDefinitions, blocks, layouts, pages } from "../../schema";
import { createBlock } from "../blocks/service";
import { publishLayout } from "../layouts/service";
import { referenceTargets } from "./reference-publication";
import {
  createRecord,
  editRecord,
  findRecordsByField,
  listRecordPageValues,
  publishRecord,
  readRecord,
  syncCollectionDefinitions,
} from "./service";
import { collectionDefinitionInput } from "./validation";

const { id, ...articleDefinition } = articles._internal;
const serialized = JSON.parse(JSON.stringify({ ...articleDefinition, collectionId: id }));
// Without the playground's slug pattern, editors can store any value, as in a real project.
delete serialized.contentSchema.properties.slug.pattern;
const definition = collectionDefinitionInput.parse(serialized);
const article = { title: "Hello", slug: "hello", excerpt: "", body: "", cover: null };

async function fixture(suffix: string) {
  const base = await createProjectFixture(`record-pages-${suffix}`);
  const ctx = createServiceContext(base.db, base.memberUser);
  const publicCtx = createServiceContext(base.db, null);
  const scope = { projectSlug: base.project.slug, collectionId: "articles" };
  await runService(
    syncCollectionDefinitions(publicCtx, {
      projectSlug: base.project.slug,
      deployToken: "test-deploy-token",
      autoCreate: false,
      definitions: [definition],
    }),
  );
  const create = (content: Record<string, unknown>) =>
    runService(createRecord(ctx, { ...scope, content: { ...article, ...content } }));
  const publish = (record: { id: string; version: number }) =>
    runService(publishRecord(ctx, { ...scope, id: record.id, expectedVersion: record.version }));
  const find = (
    value: string,
    source: "draft" | "live",
    context = source === "draft" ? ctx : publicCtx,
  ) => runService(findRecordsByField(context, { ...scope, field: "slug", value, source }));
  const list = (source: "draft" | "live", context = source === "draft" ? ctx : publicCtx) =>
    runService(listRecordPageValues(context, { ...scope, field: "slug", source }));
  return { ...base, ctx, publicCtx, scope, create, publish, find, list };
}

describe("finding the records a record page renders", () => {
  it("matches draft values in preview and published values for visitors", async () => {
    const f = await fixture("sources");
    const record = await f.create({ title: "Published title", slug: "old-slug" });
    const { record: published } = await f.publish(record);
    await runService(
      editRecord(f.ctx, {
        ...f.scope,
        id: record.id,
        expectedVersion: published.version,
        content: { ...article, title: "Draft title", slug: "new-slug" },
      }),
    );
    const draftOnly = await f.create({ title: "Unpublished", slug: "draft-only" });

    expect(await f.find("new-slug", "draft")).toEqual([
      { id: record.id, content: { ...article, title: "Draft title", slug: "new-slug" } },
    ]);
    expect(await f.find("old-slug", "draft")).toEqual([]);
    expect(await f.find("old-slug", "live")).toEqual([
      { id: record.id, content: { ...article, title: "Published title", slug: "old-slug" } },
    ]);
    expect(await f.find("new-slug", "live")).toEqual([]);
    expect(await f.find("draft-only", "draft")).toEqual([
      { id: draftOnly.id, content: { ...article, title: "Unpublished", slug: "draft-only" } },
    ]);
    // A never-published record has no live content.
    expect(await f.find("draft-only", "live")).toEqual([]);
  });

  it("compares the plain text of values stored as rich text", async () => {
    const f = await fixture("rich-text");
    const record = await f.create({ slug: plainTextToLexicalState("rich-slug") });
    expect(await f.find("rich-slug", "draft")).toMatchObject([{ id: record.id }]);
  });

  it("returns every record sharing a value, so the caller can report the ambiguity", async () => {
    const f = await fixture("ambiguous");
    const first = await f.create({ title: "First" });
    const second = await f.create({ title: "Second" });
    const ids = (await f.find("hello", "draft")).map((record) => record.id);
    expect(ids.toSorted()).toEqual([first.id, second.id].toSorted());
  });

  it("never matches an empty value or one containing a slash", async () => {
    const f = await fixture("unroutable");
    await f.create({ slug: "" });
    await f.create({ slug: "a/b" });
    expect(await f.find("", "draft")).toEqual([]);
    expect(await f.find("a/b", "draft")).toEqual([]);
  });

  it("requires an authorized user for drafts, and rejects fields that aren't String fields", async () => {
    const f = await fixture("auth");
    await f.create({});
    await expect(f.find("hello", "draft", f.publicCtx)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const outsider = createServiceContext(f.db, f.outsiderUser);
    await expect(f.find("hello", "draft", outsider)).rejects.toThrow();
    await expect(
      runService(
        findRecordsByField(f.ctx, {
          ...f.scope,
          field: "cover",
          value: "hello",
          source: "draft",
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("never returns another environment's or project's record", async () => {
    const f = await fixture("isolation");
    await f.publish(await f.create({}));
    const devCtx = { ...f.ctx, environmentName: `dev:${f.memberUser.email}` };
    await runService(
      syncCollectionDefinitions(devCtx, {
        projectSlug: f.project.slug,
        autoCreate: true,
        definitions: [definition],
      }),
    );
    expect(await f.find("hello", "draft", devCtx)).toEqual([]);
    expect(
      await f.find("hello", "live", { ...f.publicCtx, environmentName: devCtx.environmentName }),
    ).toEqual([]);
    const other = await fixture("isolation-other");
    expect(await other.find("hello", "draft")).toEqual([]);
    expect(await other.find("hello", "live")).toEqual([]);
  });
});

describe("listing the records that can have a page", () => {
  it("lists draft values in preview and published values for visitors", async () => {
    const f = await fixture("list-sources");
    const record = await f.create({ slug: "old-slug" });
    const { record: published } = await f.publish(record);
    await runService(
      editRecord(f.ctx, {
        ...f.scope,
        id: record.id,
        expectedVersion: published.version,
        content: { ...article, slug: "new-slug" },
      }),
    );
    const draftOnly = await f.create({ slug: plainTextToLexicalState("draft-only") });

    expect((await f.list("draft")).toSorted((a, b) => a.value.localeCompare(b.value))).toEqual([
      { id: draftOnly.id, value: "draft-only" },
      { id: record.id, value: "new-slug" },
    ]);
    expect(await f.list("live")).toEqual([{ id: record.id, value: "old-slug" }]);
  });

  it("leaves out empty values and values containing a slash, and keeps shared values", async () => {
    const f = await fixture("list-unroutable");
    await f.create({ slug: "" });
    await f.create({ slug: "a/b" });
    const first = await f.create({ slug: "twin" });
    const second = await f.create({ slug: "twin" });
    expect((await f.list("draft")).map((entry) => entry.id).toSorted()).toEqual(
      [first.id, second.id].toSorted(),
    );
  });

  it("returns nothing for an empty collection", async () => {
    const f = await fixture("list-empty");
    expect(await f.list("draft")).toEqual([]);
    expect(await f.list("live")).toEqual([]);
  });

  it("requires an authorized user for drafts and stays in its environment", async () => {
    const f = await fixture("list-auth");
    await f.publish(await f.create({}));
    await expect(f.list("draft", f.publicCtx)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(f.list("draft", createServiceContext(f.db, f.outsiderUser))).rejects.toThrow();
    const devCtx = { ...f.ctx, environmentName: `dev:${f.memberUser.email}` };
    await runService(
      syncCollectionDefinitions(devCtx, {
        projectSlug: f.project.slug,
        autoCreate: true,
        definitions: [definition],
      }),
    );
    expect(await f.list("draft", devCtx)).toEqual([]);
    const other = await fixture("list-auth-other");
    expect(await other.list("live")).toEqual([]);
  });
});

describe("publishing a record from its record page", () => {
  const layoutTargets = (
    f: Awaited<ReturnType<typeof fixture>>,
    pageRecord: { collectionId: string; id: string },
    includeLayout = true,
  ) =>
    runService(referenceTargets(f.ctx, { id: f.layout.id, pageRecord, includeLayout }, "layout"));
  const livePointer = async (f: Awaited<ReturnType<typeof fixture>>) =>
    (await f.db.select().from(layouts).where(eq(layouts.id, f.layout.id)).get())
      ?.livePublishedCheckpointId;

  /** A layout block featuring the record, so the layout reaches it on its own. */
  async function featureInLayout(f: Awaited<ReturnType<typeof fixture>>, recordId: string) {
    await f.db.insert(blockDefinitions).values({
      projectId: f.project.id,
      environmentId: f.environment.id,
      blockId: "featured-article",
      title: "Featured article",
      description: "",
      contentSchema: {
        type: "object",
        properties: {
          article: {
            fieldType: "Reference",
            collectionId: "articles",
            anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
            default: null,
          },
        },
        required: ["article"],
        additionalProperties: false,
      },
      createdAt: 1,
      updatedAt: 1,
    });
    const page = await f.db
      .insert(pages)
      .values({
        projectId: f.project.id,
        environmentId: f.environment.id,
        layoutId: f.layout.id,
        pathSegment: "host",
        fullPath: "/host",
        nickname: "",
        createdAt: 1,
        updatedAt: 1,
        contentUpdatedAt: 1,
      })
      .returning()
      .get();
    const block = await runService(
      createBlock(f.ctx, {
        pageId: page.id,
        type: "featured-article",
        content: { article: recordId },
      }),
    );
    await f.db
      .update(blocks)
      .set({ pageId: null, layoutId: f.layout.id, slot: "before" })
      .where(eq(blocks.id, block.id));
  }

  it("lists the page's record as an optional target, once when a layout block also shows it", async () => {
    const f = await fixture("publish-target");
    const record = await f.create({ title: "Launch" });
    const pageRecord = { collectionId: "articles", id: record.id };

    expect(
      (await runService(referenceTargets(f.ctx, { id: f.layout.id }, "layout"))).targets,
    ).toEqual([]);
    expect((await layoutTargets(f, pageRecord)).targets).toEqual([
      {
        id: record.id,
        collectionId: "articles",
        label: "Launch",
        expectedVersion: 1,
        status: "draft",
        required: false,
        hasPublishedRevision: false,
      },
    ]);

    await featureInLayout(f, record.id);
    expect((await layoutTargets(f, pageRecord)).targets).toMatchObject([{ id: record.id }]);
  });

  it("rejects a page record from another collection or environment", async () => {
    const f = await fixture("publish-scope");
    const record = await f.create({});
    const devCtx = { ...f.ctx, environmentName: `dev:${f.memberUser.email}` };
    await runService(
      syncCollectionDefinitions(devCtx, {
        projectSlug: f.project.slug,
        autoCreate: true,
        definitions: [definition],
      }),
    );
    const devRecord = await runService(createRecord(devCtx, { ...f.scope, content: article }));

    await expect(
      layoutTargets(f, { collectionId: "customers", id: record.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      layoutTargets(f, { collectionId: "articles", id: devRecord.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      runService(
        publishLayout(f.ctx, {
          id: f.layout.id,
          pageRecord: { collectionId: "articles", id: devRecord.id },
          includeLayout: false,
          collections: [{ id: devRecord.id, collectionId: "articles", expectedVersion: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Still unpublished in its own environment.
    expect(await runService(readRecord(devCtx, { ...f.scope, id: devRecord.id }))).toBeNull();
  });

  it("publishes the record and the layout independently of each other", async () => {
    const f = await fixture("publish-independent");
    const record = await f.create({ title: "First take" });
    const pageRecord = { collectionId: "articles", id: record.id };

    await runService(
      publishLayout(f.ctx, {
        id: f.layout.id,
        pageRecord,
        includeLayout: false,
        collections: [{ id: record.id, collectionId: "articles", expectedVersion: 1 }],
      }),
    );
    expect(await livePointer(f)).toBeNull();
    // The visitor's record page now finds the published content.
    expect(await f.find("hello", "live")).toEqual([
      { id: record.id, content: { ...article, title: "First take" } },
    ]);

    await runService(
      editRecord(f.ctx, {
        ...f.scope,
        id: record.id,
        expectedVersion: 2,
        content: { ...article, title: "Second take" },
      }),
    );
    expect((await layoutTargets(f, pageRecord, false)).targets).toMatchObject([
      { id: record.id, status: "modified" },
    ]);
    await runService(publishLayout(f.ctx, { id: f.layout.id, pageRecord }));
    expect(await livePointer(f)).not.toBeNull();
    expect(await f.find("hello", "live")).toMatchObject([{ content: { title: "First take" } }]);
  });
});
