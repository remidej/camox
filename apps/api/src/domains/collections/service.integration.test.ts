import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { collection as articles } from "../../../../playground/src/collections/articles";
import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { markdownToLexicalState, plainTextToLexicalState } from "../../lib/lexical-state";
import { environments, files, layouts } from "../../schema";
import { checkCompatibility, replicateEnvironment } from "../environments/service";
import { deleteFile, deleteFiles } from "../files/service";
import { deleteProject } from "../projects/service";
import { collectionDefinitions, collectionRevisions } from "./schema";
import {
  checkpointRecord,
  createRecord,
  editRecord,
  publishRecord,
  readRecord,
  restoreRecord,
  syncCollectionDefinitions,
  unpublishRecord,
} from "./service";
import { collectionDefinitionInput } from "./validation";

const { id, ...articleDefinition } = articles._internal;
const definition = collectionDefinitionInput.parse(
  JSON.parse(
    JSON.stringify({
      ...articleDefinition,
      collectionId: id,
    }),
  ),
);
const article = {
  title: "Hello",
  slug: "hello",
  excerpt: "An example",
  body: "Public body",
  cover: {
    url: "https://placehold.co/1200x800.png",
    alt: "Cover",
    filename: "cover.png",
    mimeType: "image/png",
  },
};

async function fixture(suffix: string) {
  const base = await createProjectFixture(`collections-${suffix}`);
  const ctx = createServiceContext(base.db, base.memberUser);
  const publicCtx = createServiceContext(base.db, null);
  const scope = { projectSlug: base.project.slug, collectionId: "articles" };
  const sync = (definitions = [definition]) =>
    syncCollectionDefinitions(publicCtx, {
      projectSlug: base.project.slug,
      deployToken: "test-deploy-token",
      autoCreate: false,
      definitions,
    });
  await sync();
  return { ...base, ctx, publicCtx, scope, sync };
}

describe("collection record lifecycle (repeatable articles service fixture)", () => {
  it("validates the supported scalar/asset-list fields and rejects unsupported definitions", async () => {
    const f = await fixture("field-matrix");
    const fields = {
      ...definition.contentSchema.properties,
      enabled: { type: "boolean", fieldType: "Boolean" as const },
      category: { type: "string", fieldType: "Enum" as const, enum: ["news", "guide"] },
      video: { type: "string", fieldType: "Embed" as const, pattern: "^https://example\\.com/" },
      gallery: {
        type: "array",
        fieldType: "ImageList" as const,
        minItems: 0,
        maxItems: 1,
        items: definition.contentSchema.properties.cover,
      },
      documents: {
        type: "array",
        fieldType: "FileList" as const,
        minItems: 0,
        maxItems: 2,
        items: { type: "object", fieldType: "File", accept: ["application/pdf"] },
      },
    };
    await f.sync([
      {
        ...definition,
        contentSchema: {
          ...definition.contentSchema,
          properties: fields,
          required: Object.keys(fields),
        },
      },
    ]);
    const pdf = {
      ...article.cover,
      url: "https://example.com/doc.pdf",
      filename: "doc.pdf",
      mimeType: "application/pdf",
    };
    const content = {
      ...article,
      enabled: true,
      category: "news",
      video: "https://example.com/video",
      gallery: [article.cover],
      documents: [pdf],
    };
    const record = await createRecord(f.ctx, { ...f.scope, content });
    expect(record.draft).toEqual(content);
    for (const invalid of [
      { ...content, enabled: "true" },
      { ...content, category: "unknown" },
      { ...content, video: "https://elsewhere.com/video" },
      { ...content, gallery: [article.cover, article.cover] },
      { ...content, gallery: [pdf] },
      { ...content, documents: [article.cover] },
    ])
      await expect(createRecord(f.ctx, { ...f.scope, content: invalid })).rejects.toThrow();
    for (const fieldType of ["Repeater", "Link", "Icon", "Reference"]) {
      const malformed = {
        ...definition,
        contentSchema: {
          ...definition.contentSchema,
          properties: {
            ...definition.contentSchema.properties,
            unsupported: { type: "object", fieldType },
          },
          required: [...definition.contentSchema.required, "unsupported"],
        },
      };
      expect(collectionDefinitionInput.safeParse(malformed).success).toBe(false);
    }
  });

  it("allows only one of two concurrent edits against the same draft version", async () => {
    const f = await fixture("concurrent");
    const record = await createRecord(f.ctx, { ...f.scope, content: article });
    const input = { ...f.scope, id: record.id, expectedVersion: record.version };
    const results = await Promise.allSettled([
      editRecord(f.ctx, { ...input, content: { ...article, title: "One" } }),
      editRecord(f.ctx, { ...input, content: { ...article, title: "Two" } }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await readRecord(f.publicCtx, { ...f.scope, id: record.id })).toBeNull();
  });

  it("preserves existing authored String text and rejects malformed editor states", async () => {
    const f = await fixture("authored-text");
    const content = {
      ...article,
      title: plainTextToLexicalState("Rich title"),
      excerpt: JSON.stringify(plainTextToLexicalState("Rich excerpt")),
      body: markdownToLexicalState("Hello **world** and [a link](https://example.com)."),
    };
    const record = await createRecord(f.ctx, { ...f.scope, content });
    expect(record.draft).toMatchObject({
      title: content.title,
      body: content.body,
      excerpt: plainTextToLexicalState("Rich excerpt"),
    });
    const first = await publishRecord(f.ctx, {
      ...f.scope,
      id: record.id,
      expectedVersion: record.version,
    });
    await editRecord(f.ctx, {
      ...f.scope,
      id: record.id,
      expectedVersion: first.record.version,
      content: { ...article, body: plainTextToLexicalState("Private rich draft") },
    });
    expect(await readRecord(f.publicCtx, { ...f.scope, id: record.id })).toMatchObject({
      content: { body: content.body },
    });
    for (const bad of [
      { ...article, title: plainTextToLexicalState("") },
      { ...article, slug: plainTextToLexicalState("bad slug!") },
      {
        ...article,
        body: {
          root: {
            type: "root",
            version: 1,
            children: [{ type: "text", version: 1, text: "No paragraph" }],
          },
        },
      },
      {
        ...article,
        body: {
          root: { type: "root", version: 1, children: [{ type: "unsupported", version: 1 }] },
        },
      },
      { ...article, body: markdownToLexicalState("[Cross site](camox:page:999999)") },
    ])
      await expect(createRecord(f.ctx, { ...f.scope, content: bad })).rejects.toThrow();
  });

  it("does not block existing replication/deletion workflows for empty definitions", async () => {
    const f = await fixture("empty-guards");
    const target = await f.db
      .insert(environments)
      .values({
        projectId: f.project.id,
        name: "target",
        type: "development",
        createdAt: 1,
        updatedAt: 1,
      })
      .returning()
      .get();
    await f.db.insert(layouts).values({
      projectId: f.project.id,
      environmentId: target.id,
      layoutId: "default",
      contentUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const replication = {
      projectId: f.project.id,
      sourceEnvName: "production",
      targetEnvName: "target",
    };
    expect(await checkCompatibility(f.ctx, replication)).toMatchObject({ compatible: true });
    await replicateEnvironment(f.ctx, replication);
    expect(
      await f.db
        .select()
        .from(collectionDefinitions)
        .where(eq(collectionDefinitions.projectId, f.project.id)),
    ).toHaveLength(1);
    await deleteProject(f.ctx, { id: f.project.id });
    expect(
      await f.db
        .select()
        .from(collectionDefinitions)
        .where(eq(collectionDefinitions.projectId, f.project.id)),
    ).toHaveLength(0);
  });

  it("creates, edits, publishes, restores only the draft, and reads exact historical snapshots", async () => {
    const f = await fixture("lifecycle");
    expect(await readRecord(f.publicCtx, { ...f.scope, id: crypto.randomUUID() })).toBeNull();
    let record = await createRecord(f.ctx, { ...f.scope, content: article });
    const input = () => ({ ...f.scope, id: record.id, expectedVersion: record.version });
    const read = { ...f.scope, id: record.id };
    expect(await readRecord(f.publicCtx, read)).toBeNull();
    const first = await publishRecord(f.ctx, input());
    record = first.record;
    const secondRecord = await createRecord(f.ctx, {
      ...f.scope,
      content: { ...article, title: "Other record" },
    });
    record = await editRecord(f.ctx, {
      ...input(),
      content: { ...article, title: "Private edit", body: "Secret draft" },
    });
    expect(await readRecord(f.publicCtx, read)).toMatchObject({
      id: first.revision.id,
      content: article,
    });
    expect(JSON.stringify(await readRecord(f.publicCtx, read))).not.toContain("Secret draft");
    expect(await readRecord(f.publicCtx, { ...read, id: secondRecord.id })).toBeNull();
    const manual = await checkpointRecord(f.ctx, input());
    record = manual.record;
    const second = await publishRecord(f.ctx, input());
    record = second.record;
    expect(
      await readRecord(f.ctx, { ...read, source: { revisionId: first.revision.id } }),
    ).toMatchObject({ content: article });
    const restored = await restoreRecord(f.ctx, { ...input(), revisionId: first.revision.id });
    record = restored.record;
    expect(record.draft).toEqual(article);
    expect(restored.displaced.content.title).toBe("Private edit");
    expect(await readRecord(f.publicCtx, read)).toMatchObject({
      id: second.revision.id,
      content: { title: "Private edit" },
    });
    expect(
      await readRecord(f.ctx, { ...read, source: { revisionId: manual.revision.id } }),
    ).toMatchObject({ content: { title: "Private edit" } });
    expect(
      await readRecord(f.ctx, { ...read, id: secondRecord.id, source: "draft" }),
    ).toMatchObject({ draft: { title: "Other record" } });
    record = (await publishRecord(f.ctx, input())).record;
    expect(await readRecord(f.publicCtx, read)).toMatchObject({ content: article });
    record = await unpublishRecord(f.ctx, input());
    expect(await readRecord(f.publicCtx, read)).toBeNull();
    expect(record.draft).toEqual(article);
    expect(
      await readRecord(f.ctx, { ...read, source: { revisionId: first.revision.id } }),
    ).toMatchObject({ content: article });
    await expect(
      f.db
        .update(collectionRevisions)
        .set({ content: {} })
        .where(eq(collectionRevisions.id, first.revision.id)),
    ).rejects.toThrow();
  });

  it("enforces auth, site, collection, environment and revision ownership on every operation", async () => {
    const f = await fixture("isolation");
    const record = await createRecord(f.ctx, { ...f.scope, content: article });
    const input = { ...f.scope, id: record.id, expectedVersion: record.version };
    const read = { ...f.scope, id: record.id };
    const outsider = createServiceContext(f.db, f.outsiderUser);
    for (const ctx of [f.publicCtx, outsider]) {
      await expect(createRecord(ctx, { ...f.scope, content: article })).rejects.toThrow();
      await expect(editRecord(ctx, { ...input, content: article })).rejects.toThrow();
      await expect(publishRecord(ctx, input)).rejects.toThrow();
      await expect(checkpointRecord(ctx, input)).rejects.toThrow();
      await expect(unpublishRecord(ctx, input)).rejects.toThrow();
      await expect(
        restoreRecord(ctx, { ...input, revisionId: crypto.randomUUID() }),
      ).rejects.toThrow();
      await expect(readRecord(ctx, { ...read, source: "draft" })).rejects.toThrow();
      await expect(
        readRecord(ctx, { ...read, source: { revisionId: crypto.randomUUID() } }),
      ).rejects.toThrow();
    }
    const published = await publishRecord(f.ctx, input);
    const other = await createRecord(f.ctx, { ...f.scope, content: article });
    expect(
      await readRecord(f.ctx, {
        ...read,
        id: other.id,
        source: { revisionId: published.revision.id },
      }),
    ).toBeNull();
    await expect(
      restoreRecord(f.ctx, { ...input, id: other.id, revisionId: published.revision.id }),
    ).rejects.toThrow();
    const anotherSite = await fixture("another-site");
    expect(
      await readRecord(anotherSite.publicCtx, { ...anotherSite.scope, id: record.id }),
    ).toBeNull();
    await expect(
      editRecord(anotherSite.ctx, { ...input, ...anotherSite.scope, content: article }),
    ).rejects.toThrow();
    const devCtx = { ...f.ctx, environmentName: `dev:${f.memberUser.email}` };
    await syncCollectionDefinitions(devCtx, {
      projectSlug: f.project.slug,
      autoCreate: true,
      definitions: [definition],
    });
    expect(await readRecord(devCtx, { ...read, source: "draft" })).toBeNull();
    await expect(
      publishRecord(devCtx, { ...input, expectedVersion: published.record.version }),
    ).rejects.toThrow();
    await f.sync([definition, { ...definition, collectionId: "customers" }]);
    expect(await readRecord(f.publicCtx, { ...read, collectionId: "customers" })).toBeNull();
    await expect(
      editRecord(f.ctx, { ...input, collectionId: "customers", content: article }),
    ).rejects.toThrow();
  });

  it("rejects malformed content and stale edits; validates managed asset ownership", async () => {
    const f = await fixture("validation");
    for (const content of [
      {},
      { ...article, title: 42 },
      { ...article, slug: "Invalid Slug" },
      { ...article, extra: true },
      { ...article, cover: { ...article.cover, url: "javascript:alert(1)" } },
      { ...article, cover: { ...article.cover, mimeType: "application/pdf" } },
    ]) {
      await expect(createRecord(f.ctx, { ...f.scope, content })).rejects.toThrow();
    }
    const file = await f.db
      .insert(files)
      .values({
        projectId: f.project.id,
        environmentId: f.environment.id,
        url: "https://example.com/real.png",
        alt: "",
        filename: "real.png",
        mimeType: "image/png",
        size: 5,
        blobId: "test",
        path: "real.png",
        createdAt: 1,
        updatedAt: 1,
      })
      .returning()
      .get();
    const record = await createRecord(f.ctx, {
      ...f.scope,
      content: { ...article, cover: { ...article.cover, _fileId: String(file.id) } },
    });
    expect(record.draft.cover).toMatchObject({ url: file.url, filename: file.filename });
    const input = { ...f.scope, id: record.id, expectedVersion: record.version };
    const live = await publishRecord(f.ctx, input);
    await f.db.update(files).set({ alt: "changed metadata" }).where(eq(files.id, file.id));
    expect(await readRecord(f.publicCtx, { ...f.scope, id: record.id })).toMatchObject({
      content: { cover: { alt: "Cover" } },
    });
    await expect(deleteFile(f.ctx, { id: file.id })).rejects.toMatchObject({ status: 409 });
    await expect(deleteFiles(f.ctx, { ids: [file.id] })).rejects.toMatchObject({ status: 409 });
    await expect(editRecord(f.ctx, { ...input, content: article })).rejects.toMatchObject({
      status: 409,
    });
    await expect(publishRecord(f.ctx, input)).rejects.toMatchObject({ status: 409 });
    const devEnvironment = await f.db
      .insert(environments)
      .values({
        projectId: f.project.id,
        name: "other",
        type: "development",
        createdAt: 1,
        updatedAt: 1,
      })
      .returning()
      .get();
    await f.db.update(files).set({ environmentId: devEnvironment.id }).where(eq(files.id, file.id));
    await expect(
      editRecord(f.ctx, {
        ...input,
        expectedVersion: live.record.version,
        content: { ...article, cover: { ...article.cover, _fileId: String(file.id) } },
      }),
    ).rejects.toThrow();
  });

  it("syncs reversibly, rejects schema changes with records, and authorizes sync", async () => {
    const f = await fixture("sync");
    await expect(
      syncCollectionDefinitions(f.publicCtx, {
        projectSlug: f.project.slug,
        autoCreate: false,
        definitions: [definition],
      }),
    ).rejects.toThrow();
    await expect(
      syncCollectionDefinitions(f.ctx, {
        projectSlug: f.project.slug,
        autoCreate: false,
        definitions: [definition],
      }),
    ).rejects.toThrow();
    await expect(f.sync([{ ...definition, label: "cover" }])).rejects.toThrow();
    await expect(f.sync([definition, definition])).rejects.toThrow();
    const record = await createRecord(f.ctx, { ...f.scope, content: article });
    const input = { ...f.scope, id: record.id, expectedVersion: record.version };
    const live = await publishRecord(f.ctx, input);
    await expect(
      f.sync([
        {
          ...definition,
          contentSchema: {
            ...definition.contentSchema,
            properties: {
              ...definition.contentSchema.properties,
              title: { type: "string", fieldType: "String", maxLength: 2 },
            },
          },
        },
      ]),
    ).rejects.toMatchObject({ status: 409 });
    await f.sync([{ ...definition, title: "Renamed articles", label: "slug" }]);
    await f.sync([]);
    expect(await readRecord(f.publicCtx, { ...f.scope, id: record.id })).toBeNull();
    expect(await readRecord(f.ctx, { ...f.scope, id: record.id, source: "draft" })).toMatchObject({
      draft: article,
    });
    await expect(
      editRecord(f.ctx, { ...input, expectedVersion: live.record.version, content: article }),
    ).rejects.toThrow();
    await f.sync();
    expect(await readRecord(f.publicCtx, { ...f.scope, id: record.id })).toMatchObject({
      id: live.revision.id,
      content: article,
    });
    expect(
      await f.db
        .select()
        .from(collectionDefinitions)
        .where(eq(collectionDefinitions.projectId, f.project.id)),
    ).toHaveLength(1);
    await expect(deleteProject(f.ctx, { id: f.project.id })).rejects.toMatchObject({ status: 409 });
    await f.db.insert(environments).values({
      projectId: f.project.id,
      name: "target",
      type: "development",
      createdAt: 1,
      updatedAt: 1,
    });
    const replication = {
      projectId: f.project.id,
      sourceEnvName: "production",
      targetEnvName: "target",
    };
    expect(await checkCompatibility(f.ctx, replication)).toMatchObject({
      compatible: false,
      reasons: expect.arrayContaining([{ kind: "collections-replication-unsupported" }]),
    });
    await expect(replicateEnvironment(f.ctx, replication)).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
    });
  });
});
