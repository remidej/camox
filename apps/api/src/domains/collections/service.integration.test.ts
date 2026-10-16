import { generateUuidv7 } from "@camox/api-contract/ids";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { collection as articles } from "../../../../playground/src/collections/articles";
import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { markdownToLexicalState, plainTextToLexicalState } from "../../lib/lexical-state";
import { runService } from "../../lib/run-service";
import { files, pages } from "../../schema";
import { deleteProject } from "../projects/service";
import { collectionDefinitions } from "./schema";
import {
  createRecord,
  editRecord,
  deleteRecord,
  getCollectionDefinition,
  getCollectionRecord,
  listCollectionDefinitions,
  listCollectionRecords,
  syncCollectionDefinitions,
} from "./service";
import { collectionDefinitionInput } from "./validation";

const { id, ...articleDefinition } = articles._internal;
const serialized = JSON.parse(JSON.stringify({ ...articleDefinition, collectionId: id }));
// These tests cover one collection on its own, without the authors it links.
delete serialized.contentSchema.properties.author;
serialized.contentSchema.required = serialized.contentSchema.required.filter(
  (key: string) => key !== "author",
);
const definition = collectionDefinitionInput.parse(serialized);
const article = {
  title: "Hello",
  slug: "hello",
  excerpt: "An example",
  body: "Public body",
  cover: null,
};
const placeholder = {
  url: "https://example.com/placeholder.png",
  alt: "",
  filename: "placeholder.png",
  mimeType: "image/png",
};

async function fixture(suffix: string) {
  const base = await createProjectFixture(`collections-${suffix}`);
  const ctx = createServiceContext(base.db, base.memberUser);
  const publicCtx = createServiceContext(base.db, null);
  const scope = { projectSlug: base.project.slug, collectionId: "articles" };
  const sync = (definitions = [definition]) =>
    runService(
      syncCollectionDefinitions(publicCtx, {
        projectSlug: base.project.slug,
        deployToken: "test-deploy-token",
        autoCreate: false,
        definitions,
      }),
    );
  const insertFile = (name: string, mimeType = "image/png") =>
    base.db
      .insert(files)
      .values({
        projectId: base.project.id,
        url: `https://example.com/${name}`,
        alt: `Alt for ${name}`,
        filename: name,
        mimeType,
        size: 5,
        blobId: `${suffix}-${name}`,
        path: name,
        createdAt: 1,
        updatedAt: 1,
      })
      .returning()
      .get();
  await sync();
  return { ...base, ctx, publicCtx, scope, sync, insertFile };
}

describe("authenticated collection browsing", () => {
  it("stores empty and unlinked assets as null without materializing preview defaults", async () => {
    const f = await fixture("empty-assets");
    const created = await runService(createRecord(f.ctx, { ...f.scope, content: article }));
    expect(created.content.cover).toBeNull();
    const cover = await f.insertFile("cover.png");
    await runService(
      editRecord(f.ctx, {
        ...f.scope,
        id: created.id,
        content: { ...article, cover: { _fileId: cover.id } },
      }),
    );
    const unlinked = await runService(
      editRecord(f.ctx, { ...f.scope, id: created.id, content: article }),
    );
    expect(unlinked.content.cover).toBeNull();
  });

  it("loads records within their authorized collection", async () => {
    const f = await fixture("authoring");
    const created = await runService(createRecord(f.ctx, { ...f.scope, content: article }));
    const input = { ...f.scope, id: created.id };
    expect(await runService(getCollectionRecord(f.ctx, input))).toEqual(created);
    await expect(runService(getCollectionRecord(f.publicCtx, input))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      runService(getCollectionRecord(createServiceContext(f.db, f.outsiderUser), input)),
    ).rejects.toThrow();
    await expect(
      runService(getCollectionRecord(f.ctx, { ...input, collectionId: "other" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      runService(getCollectionRecord(f.ctx, { ...input, id: generateUuidv7() })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await runService(
      editRecord(f.ctx, { ...input, content: { ...article, title: "Updated title" } }),
    );
    expect((await runService(getCollectionRecord(f.ctx, input))).content.title).toBe(
      "Updated title",
    );
    expect(await runService(listCollectionRecords(f.ctx, f.scope))).toEqual([
      { id: created.id, label: "Updated title", duplicatePageValue: false },
    ]);
    await expect(
      runService(createRecord(f.ctx, { ...f.scope, content: {} })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("returns the definition's stored TypeBox schema and metadata from the request's own definitions", async () => {
    const f = await fixture("browse-get");
    expect(await runService(getCollectionDefinition(f.ctx, f.scope))).toEqual({
      collectionId: definition.collectionId,
      title: definition.title,
      description: definition.description,
      label: definition.label,
      contentSchema: definition.contentSchema,
    });

    // The development draft has its own definitions, separate from Live's.
    const devCtx = { ...f.ctx, draft: { development: true as const } };
    await runService(
      syncCollectionDefinitions(devCtx, {
        projectSlug: f.project.slug,
        autoCreate: true,
        definitions: [],
      }),
    );
    await expect(runService(getCollectionDefinition(devCtx, f.scope))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await runService(getCollectionDefinition(f.ctx, f.scope))).toMatchObject({
      title: definition.title,
    });
    await runService(
      syncCollectionDefinitions(devCtx, {
        projectSlug: f.project.slug,
        autoCreate: false,
        definitions: [{ ...definition, title: "Development articles" }],
      }),
    );
    expect(await runService(getCollectionDefinition(devCtx, f.scope))).toMatchObject({
      title: "Development articles",
      contentSchema: definition.contentSchema,
    });
    expect(await runService(getCollectionDefinition(f.ctx, f.scope))).toMatchObject({
      title: definition.title,
    });
    await runService(
      syncCollectionDefinitions(devCtx, {
        projectSlug: f.project.slug,
        autoCreate: false,
        definitions: [],
      }),
    );
    await expect(runService(getCollectionDefinition(devCtx, f.scope))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      runService(getCollectionDefinition(f.ctx, { ...f.scope, collectionId: "missing" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists the definitions code declares in the request's project and draft, newest first", async () => {
    const f = await fixture("browse");
    const input = { projectSlug: f.project.slug };
    const newer = { ...definition, collectionId: "newer", title: "Newer" };
    await f.sync([definition, newer]);
    const metadata = ({ collectionId, title, description, label }: typeof definition) => ({
      collectionId,
      title,
      description,
      label,
    });
    expect(await runService(listCollectionDefinitions(f.ctx, input))).toEqual([
      metadata(newer),
      metadata(definition),
    ]);
    const other = await fixture("browse-other");
    expect(
      await runService(listCollectionDefinitions(other.ctx, { projectSlug: other.project.slug })),
    ).toEqual([metadata(definition)]);
    // The development draft lists its own definitions; Live keeps its.
    const devCtx = { ...f.ctx, draft: { development: true as const } };
    await runService(
      syncCollectionDefinitions(devCtx, { ...input, autoCreate: true, definitions: [newer] }),
    );
    expect(await runService(listCollectionDefinitions(devCtx, input))).toEqual([metadata(newer)]);
    expect(await runService(listCollectionDefinitions(f.ctx, input))).toEqual([
      metadata(newer),
      metadata(definition),
    ]);
    await f.sync([definition]);
    expect(await runService(listCollectionDefinitions(f.ctx, input))).toEqual([
      metadata(definition),
    ]);
    await f.sync([]);
    expect(await runService(listCollectionDefinitions(f.ctx, input))).toEqual([]);
  });

  it("hides a removed collection's records and brings them back with it", async () => {
    const f = await fixture("browse-removed");
    const record = await runService(createRecord(f.ctx, { ...f.scope, content: article }));
    const result = await f.sync([]);
    expect(result.retired).toEqual(["articles"]);
    const read = { ...f.scope, id: record.id };
    await expect(runService(listCollectionRecords(f.ctx, f.scope))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(runService(getCollectionRecord(f.ctx, read))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      runService(editRecord(f.ctx, { ...read, content: { ...article, title: "Edited" } })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(runService(deleteRecord(f.ctx, read))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    await f.sync();
    expect(await runService(getCollectionRecord(f.ctx, read))).toEqual(record);
  });

  it("requires membership and authentication for browsing", async () => {
    const f = await fixture("browse-auth");
    for (const ctx of [f.publicCtx, createServiceContext(f.db, f.outsiderUser)]) {
      const code = ctx.user ? "FORBIDDEN" : "UNAUTHORIZED";
      await expect(
        runService(listCollectionDefinitions(ctx, { projectSlug: f.project.slug })),
      ).rejects.toMatchObject({ code });
      await expect(runService(getCollectionDefinition(ctx, f.scope))).rejects.toMatchObject({
        code,
      });
      await expect(runService(listCollectionRecords(ctx, f.scope))).rejects.toMatchObject({ code });
    }
    await expect(
      runService(listCollectionDefinitions(f.ctx, { projectSlug: "missing" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      runService(listCollectionRecords(f.ctx, { ...f.scope, collectionId: "missing" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists records newest first with plain text labels, isolated by collection and draft", async () => {
    const f = await fixture("browse-records");
    expect(await runService(listCollectionRecords(f.ctx, f.scope))).toEqual([]);
    const record = await runService(createRecord(f.ctx, { ...f.scope, content: article }));
    await runService(
      editRecord(f.ctx, {
        ...f.scope,
        id: record.id,
        content: { ...article, title: plainTextToLexicalState("Rich title") },
      }),
    );
    const newer = await runService(createRecord(f.ctx, { ...f.scope, content: article }));
    expect(await runService(listCollectionRecords(f.ctx, f.scope))).toEqual([
      { id: newer.id, label: "Hello", duplicatePageValue: false },
      { id: record.id, label: "Rich title", duplicatePageValue: false },
    ]);
    await f.sync([definition, { ...definition, collectionId: "other" }]);
    expect(
      await runService(listCollectionRecords(f.ctx, { ...f.scope, collectionId: "other" })),
    ).toEqual([]);
    const devCtx = { ...f.ctx, draft: { development: true as const } };
    await runService(
      syncCollectionDefinitions(devCtx, {
        projectSlug: f.project.slug,
        autoCreate: true,
        definitions: [definition],
      }),
    );
    // Live's records show through in the development draft; its own stay out of Live.
    const live = await runService(listCollectionRecords(f.ctx, f.scope));
    expect(await runService(listCollectionRecords(devCtx, f.scope))).toEqual(live);
    const drafted = await runService(
      createRecord(devCtx, { ...f.scope, content: { ...article, title: "Drafted" } }),
    );
    expect(await runService(listCollectionRecords(devCtx, f.scope))).toEqual([
      { id: drafted.id, label: "Drafted", duplicatePageValue: false },
      ...live,
    ]);
    expect(await runService(listCollectionRecords(f.ctx, f.scope))).toEqual(live);
    const other = await fixture("browse-records-other");
    expect(await runService(listCollectionRecords(other.ctx, other.scope))).toEqual([]);
  });
});

describe("collection record lifecycle", () => {
  it("deletes an authorized record while protecting foreign requests, and keeps its files", async () => {
    const f = await fixture("delete-record");
    const file = await f.insertFile("cover.png");
    const created = await runService(
      createRecord(f.ctx, { ...f.scope, content: { ...article, cover: { _fileId: file.id } } }),
    );
    const input = { ...f.scope, id: created.id };
    await expect(runService(deleteRecord(f.publicCtx, input))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      runService(deleteRecord(createServiceContext(f.db, f.outsiderUser), input)),
    ).rejects.toThrow();
    await f.sync([definition, { ...definition, collectionId: "other" }]);
    await expect(
      runService(deleteRecord(f.ctx, { ...input, collectionId: "other" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const other = await runService(createRecord(f.ctx, { ...f.scope, content: article }));
    await runService(deleteRecord(f.ctx, input));
    await expect(runService(getCollectionRecord(f.ctx, input))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await runService(listCollectionRecords(f.ctx, f.scope))).toEqual([
      { id: other.id, label: "Hello", duplicatePageValue: false },
    ]);
    await expect(runService(deleteRecord(f.ctx, input))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await f.db.select().from(files).where(eq(files.id, file.id)).get()).toEqual(file);
  });

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
    const image = { _fileId: (await f.insertFile("photo.png")).id };
    const pdf = { _fileId: (await f.insertFile("doc.pdf", "application/pdf")).id };
    const content = {
      ...article,
      enabled: true,
      category: "news",
      video: "https://example.com/video",
      gallery: [image],
      documents: [pdf],
    };
    const record = await runService(createRecord(f.ctx, { ...f.scope, content }));
    expect(record.content).toMatchObject({
      ...content,
      gallery: [{ ...image, filename: "photo.png" }],
      documents: [{ ...pdf, filename: "doc.pdf" }],
    });
    for (const invalid of [
      { ...content, enabled: "true" },
      { ...content, category: "unknown" },
      { ...content, video: "https://elsewhere.com/video" },
      { ...content, gallery: [image, image] },
      { ...content, gallery: [pdf] },
      { ...content, documents: [image] },
    ])
      await expect(
        runService(createRecord(f.ctx, { ...f.scope, content: invalid })),
      ).rejects.toThrow();
    for (const fieldType of ["Repeater", "Link", "Icon", "Reference", "ReferenceList"]) {
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

  it("preserves existing authored String text and rejects malformed editor states", async () => {
    const f = await fixture("authored-text");
    const content = {
      ...article,
      title: plainTextToLexicalState("Rich title"),
      excerpt: JSON.stringify(plainTextToLexicalState("Rich excerpt")),
      body: markdownToLexicalState("Hello **world** and [a link](https://example.com)."),
    };
    const record = await runService(createRecord(f.ctx, { ...f.scope, content }));
    expect(record.content).toMatchObject({
      title: content.title,
      body: content.body,
      excerpt: plainTextToLexicalState("Rich excerpt"),
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
      {
        ...article,
        body: markdownToLexicalState(`[Missing page](camox:page:${generateUuidv7()})`),
      },
      { ...article, body: markdownToLexicalState("[Integer page id](camox:page:1)") },
    ])
      await expect(runService(createRecord(f.ctx, { ...f.scope, content: bad }))).rejects.toThrow();
  });

  it("stores a text link to a page by the page's UUIDv7", async () => {
    const f = await fixture("page-text-link");
    const page = await f.db
      .insert(pages)
      .values({
        projectId: f.project.id,
        layoutId: f.layout.layoutId,
        pathSegment: "about",
        fullPath: "/about",
        nickname: "About",
        contentUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .returning()
      .get();
    const body = markdownToLexicalState(`[About](camox:page:${page.id})`);
    const record = await runService(
      createRecord(f.ctx, { ...f.scope, content: { ...article, body } }),
    );
    expect(record.content).toMatchObject({ body });
  });

  it("does not block project deletion for empty definitions", async () => {
    const f = await fixture("empty-guards");
    expect(
      await f.db
        .select()
        .from(collectionDefinitions)
        .where(eq(collectionDefinitions.projectId, f.project.id)),
    ).toHaveLength(1);
    await runService(deleteProject(f.ctx, { id: f.project.id }));
    expect(
      await f.db
        .select()
        .from(collectionDefinitions)
        .where(eq(collectionDefinitions.projectId, f.project.id)),
    ).toHaveLength(0);
  });

  it("enforces auth, project, collection and draft definitions on every operation", async () => {
    const f = await fixture("isolation");
    const record = await runService(createRecord(f.ctx, { ...f.scope, content: article }));
    const input = { ...f.scope, id: record.id };
    const outsider = createServiceContext(f.db, f.outsiderUser);
    for (const ctx of [f.publicCtx, outsider]) {
      await expect(
        runService(createRecord(ctx, { ...f.scope, content: article })),
      ).rejects.toThrow();
      await expect(runService(editRecord(ctx, { ...input, content: article }))).rejects.toThrow();
      await expect(runService(deleteRecord(ctx, input))).rejects.toThrow();
      await expect(runService(getCollectionRecord(ctx, input))).rejects.toThrow();
    }
    const anotherProject = await fixture("another-project");
    await expect(
      runService(getCollectionRecord(anotherProject.ctx, { ...input, ...anotherProject.scope })),
    ).rejects.toThrow();
    await expect(
      runService(
        editRecord(anotherProject.ctx, { ...input, ...anotherProject.scope, content: article }),
      ),
    ).rejects.toThrow();
    // A development draft whose code doesn't define the collection can't reach its records.
    const devCtx = { ...f.ctx, draft: { development: true as const } };
    const syncDevelopment = (autoCreate: boolean, definitions: (typeof definition)[]) =>
      runService(
        syncCollectionDefinitions(devCtx, { projectSlug: f.project.slug, autoCreate, definitions }),
      );
    await syncDevelopment(true, []);
    await expect(runService(getCollectionRecord(devCtx, input))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(runService(deleteRecord(devCtx, input))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Once it does, Live's record shows through, and deleting it there leaves Live's in place.
    await syncDevelopment(false, [definition]);
    expect(await runService(getCollectionRecord(devCtx, input))).toEqual(record);
    await runService(deleteRecord(devCtx, input));
    await expect(runService(getCollectionRecord(devCtx, input))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await runService(getCollectionRecord(f.ctx, input))).toEqual(record);
    await f.sync([definition, { ...definition, collectionId: "customers" }]);
    await expect(
      runService(editRecord(f.ctx, { ...input, collectionId: "customers", content: article })),
    ).rejects.toThrow();
  });

  it("rejects malformed content and validates file ownership", async () => {
    const f = await fixture("validation");
    for (const content of [
      {},
      { ...article, title: 42 },
      { ...article, slug: "Invalid Slug" },
      { ...article, extra: true },
      { ...article, cover: placeholder },
      { ...article, cover: { _fileId: (await f.insertFile("doc.pdf", "application/pdf")).id } },
    ]) {
      await expect(runService(createRecord(f.ctx, { ...f.scope, content }))).rejects.toThrow();
    }
    const file = await f.insertFile("real.png");
    const record = await runService(
      createRecord(f.ctx, { ...f.scope, content: { ...article, cover: { _fileId: file.id } } }),
    );
    expect(record.content.cover).toMatchObject({ url: file.url, filename: file.filename });
    const otherProject = await fixture("validation-other");
    const foreign = await otherProject.insertFile("foreign.png");
    await expect(
      runService(
        editRecord(f.ctx, {
          ...f.scope,
          id: record.id,
          content: { ...article, cover: { _fileId: foreign.id } },
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("syncs reversibly and authorizes sync", async () => {
    const f = await fixture("sync");
    await expect(
      runService(
        syncCollectionDefinitions(f.publicCtx, {
          projectSlug: f.project.slug,
          autoCreate: false,
          definitions: [definition],
        }),
      ),
    ).rejects.toThrow();
    await expect(
      runService(
        syncCollectionDefinitions(f.ctx, {
          projectSlug: f.project.slug,
          autoCreate: false,
          definitions: [definition],
        }),
      ),
    ).rejects.toThrow();
    await expect(f.sync([{ ...definition, label: "cover" }])).rejects.toThrow();
    await expect(f.sync([definition, definition])).rejects.toThrow();
    const record = await runService(createRecord(f.ctx, { ...f.scope, content: article }));
    await f.sync([{ ...definition, title: "Renamed articles", label: "slug" }]);
    await f.sync();
    expect(await runService(getCollectionRecord(f.ctx, { ...f.scope, id: record.id }))).toEqual(
      record,
    );
    expect(
      await f.db
        .select()
        .from(collectionDefinitions)
        .where(eq(collectionDefinitions.projectId, f.project.id)),
    ).toHaveLength(1);
    await expect(runService(deleteProject(f.ctx, { id: f.project.id }))).rejects.toMatchObject({
      status: 409,
    });
  });
});
