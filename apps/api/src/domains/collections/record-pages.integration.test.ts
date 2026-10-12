import { describe, expect, it } from "vitest";

import { collection as articles } from "../../../../playground/src/collections/articles";
import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { plainTextToLexicalState } from "../../lib/lexical-state";
import { runService } from "../../lib/run-service";
import {
  createRecord,
  editRecord,
  findRecordsByField,
  publishRecord,
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
  return { ...base, ctx, publicCtx, scope, create, publish, find };
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
