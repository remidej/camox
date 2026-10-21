import { DEVELOPMENT_DRAFT, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import type { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { collection as articles } from "../../../../playground/src/collections/articles";
import {
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  seedLiveThrough,
  syncDefinitionSet,
} from "../../../test/fixtures";
import type { ServiceError } from "../../lib/errors";
import type { Journal } from "../../lib/journal";
import { markdownToLexicalState, plainTextToLexicalState } from "../../lib/lexical-state";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { files, pages } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
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
  const scope = { projectUuid: base.project.uuid, collectionId: "articles" };
  const sync = async (definitions = [definition]) =>
    (await syncDefinitionSet(base.db, base.project, { collections: definitions })).collections;
  /** Dev mode syncs the member's development draft, creating it when `autoCreate` lets it. */
  const syncDevelopment = (definitions: (typeof definition)[], autoCreate = true) =>
    call(
      router.definitions.sync,
      {
        projectUuid: base.project.uuid,
        autoCreate,
        definitionSet: { blocks: [], layouts: [], collections: definitions, homepage: null },
      },
      {
        context: createRpcContext(base.db, base.memberUser, {
          [DRAFT_HEADER]: DEVELOPMENT_DRAFT,
        }),
      },
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
  // Record writes reach Live by publishing a throwaway draft (ADR 0009).
  const live = <A>(run: (inDraft: ServiceContext) => Effect.Effect<A, ServiceError, Journal>) =>
    seedLiveThrough(ctx, base.project.id, (_draft, inDraft) => run(inDraft));
  await sync();
  return { ...base, ctx, publicCtx, scope, sync, syncDevelopment, insertFile, live };
}

describe("authenticated collection browsing", () => {
  it("stores empty and unlinked assets as null without materializing preview defaults", async () => {
    const f = await fixture("empty-assets");
    const created = await f.live((c) => createRecord(c, { ...f.scope, content: article }));
    expect(created.content.cover).toBeNull();
    const cover = await f.insertFile("cover.png");
    await f.live((c) =>
      editRecord(c, {
        ...f.scope,
        id: created.id,
        content: { ...article, cover: { _fileId: cover.id } },
      }),
    );
    const unlinked = await f.live((c) =>
      editRecord(c, { ...f.scope, id: created.id, content: article }),
    );
    expect(unlinked.content.cover).toBeNull();
  });

  it("loads records within their authorized collection", async () => {
    const f = await fixture("authoring");
    const created = await f.live((c) => createRecord(c, { ...f.scope, content: article }));
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
    await f.live((c) =>
      editRecord(c, { ...input, content: { ...article, title: "Updated title" } }),
    );
    expect((await runService(getCollectionRecord(f.ctx, input))).content.title).toBe(
      "Updated title",
    );
    expect(await runService(listCollectionRecords(f.ctx, f.scope))).toEqual([
      { id: created.id, label: "Updated title", duplicatePageValue: false },
    ]);
    await expect(f.live((c) => createRecord(c, { ...f.scope, content: {} }))).rejects.toMatchObject(
      { code: "BAD_REQUEST" },
    );
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
    await f.syncDevelopment([]);
    await expect(runService(getCollectionDefinition(devCtx, f.scope))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await runService(getCollectionDefinition(f.ctx, f.scope))).toMatchObject({
      title: definition.title,
    });
    await f.syncDevelopment([{ ...definition, title: "Development articles" }], false);
    expect(await runService(getCollectionDefinition(devCtx, f.scope))).toMatchObject({
      title: "Development articles",
      contentSchema: definition.contentSchema,
    });
    expect(await runService(getCollectionDefinition(f.ctx, f.scope))).toMatchObject({
      title: definition.title,
    });
    await f.syncDevelopment([], false);
    await expect(runService(getCollectionDefinition(devCtx, f.scope))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      runService(getCollectionDefinition(f.ctx, { ...f.scope, collectionId: "missing" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists the definitions code declares in the request's project and draft, newest first", async () => {
    const f = await fixture("browse");
    const input = { projectUuid: f.project.uuid };
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
      await runService(listCollectionDefinitions(other.ctx, { projectUuid: other.project.uuid })),
    ).toEqual([metadata(definition)]);
    // The development draft lists its own definitions; Live keeps its.
    const devCtx = { ...f.ctx, draft: { development: true as const } };
    await f.syncDevelopment([newer]);
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
    const record = await f.live((c) => createRecord(c, { ...f.scope, content: article }));
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
      f.live((c) => editRecord(c, { ...read, content: { ...article, title: "Edited" } })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.live((c) => deleteRecord(c, read))).rejects.toMatchObject({
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
        runService(listCollectionDefinitions(ctx, { projectUuid: f.project.uuid })),
      ).rejects.toMatchObject({ code });
      await expect(runService(getCollectionDefinition(ctx, f.scope))).rejects.toMatchObject({
        code,
      });
      await expect(runService(listCollectionRecords(ctx, f.scope))).rejects.toMatchObject({ code });
    }
    await expect(
      runService(listCollectionDefinitions(f.ctx, { projectUuid: generateUuidv7() })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      runService(listCollectionRecords(f.ctx, { ...f.scope, collectionId: "missing" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists records newest first with plain text labels, isolated by collection and draft", async () => {
    const f = await fixture("browse-records");
    expect(await runService(listCollectionRecords(f.ctx, f.scope))).toEqual([]);
    const record = await f.live((c) => createRecord(c, { ...f.scope, content: article }));
    await f.live((c) =>
      editRecord(c, {
        ...f.scope,
        id: record.id,
        content: { ...article, title: plainTextToLexicalState("Rich title") },
      }),
    );
    const newer = await f.live((c) => createRecord(c, { ...f.scope, content: article }));
    expect(await runService(listCollectionRecords(f.ctx, f.scope))).toEqual([
      { id: newer.id, label: "Hello", duplicatePageValue: false },
      { id: record.id, label: "Rich title", duplicatePageValue: false },
    ]);
    await f.sync([definition, { ...definition, collectionId: "other" }]);
    expect(
      await runService(listCollectionRecords(f.ctx, { ...f.scope, collectionId: "other" })),
    ).toEqual([]);
    const devCtx = { ...f.ctx, draft: { development: true as const } };
    await f.syncDevelopment([definition]);
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
    const created = await f.live((c) =>
      createRecord(c, { ...f.scope, content: { ...article, cover: { _fileId: file.id } } }),
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
      f.live((c) => deleteRecord(c, { ...input, collectionId: "other" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const other = await f.live((c) => createRecord(c, { ...f.scope, content: article }));
    await f.live((c) => deleteRecord(c, input));
    await expect(runService(getCollectionRecord(f.ctx, input))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await runService(listCollectionRecords(f.ctx, f.scope))).toEqual([
      { id: other.id, label: "Hello", duplicatePageValue: false },
    ]);
    await expect(f.live((c) => deleteRecord(c, input))).rejects.toMatchObject({
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
    const record = await f.live((c) => createRecord(c, { ...f.scope, content }));
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
        f.live((c) => createRecord(c, { ...f.scope, content: invalid })),
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

  it("accepts the files publishing accepts, whatever the case or wildcard of `accept`", async () => {
    const f = await fixture("accept-rules");
    const fileField = (accept: string[]) => ({
      type: "array",
      fieldType: "FileList" as const,
      items: { type: "object", fieldType: "File", accept },
    });
    const fields = {
      ...definition.contentSchema.properties,
      anything: fileField(["*"]),
      unrestricted: fileField([]),
      padded: fileField([" Application/PDF "]),
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
    const pdf = [{ _fileId: (await f.insertFile("doc.pdf", "application/pdf")).id }];
    const content = { ...article, anything: pdf, unrestricted: pdf, padded: pdf };
    const record = await f.live((c) => createRecord(c, { ...f.scope, content }));
    expect(record.content).toMatchObject({
      anything: [{ filename: "doc.pdf" }],
      unrestricted: [{ filename: "doc.pdf" }],
      padded: [{ filename: "doc.pdf" }],
    });
  });

  it("preserves existing authored String text and rejects malformed editor states", async () => {
    const f = await fixture("authored-text");
    const content = {
      ...article,
      title: plainTextToLexicalState("Rich title"),
      excerpt: JSON.stringify(plainTextToLexicalState("Rich excerpt")),
      body: markdownToLexicalState("Hello **world** and [a link](https://example.com)."),
    };
    const record = await f.live((c) => createRecord(c, { ...f.scope, content }));
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
      await expect(f.live((c) => createRecord(c, { ...f.scope, content: bad }))).rejects.toThrow();
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
    const record = await f.live((c) =>
      createRecord(c, { ...f.scope, content: { ...article, body } }),
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
    const record = await f.live((c) => createRecord(c, { ...f.scope, content: article }));
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
      anotherProject.live((c) =>
        editRecord(c, { ...input, ...anotherProject.scope, content: article }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A development draft whose code doesn't define the collection can't reach its records.
    const devCtx = { ...f.ctx, draft: { development: true as const } };
    await f.syncDevelopment([]);
    await expect(runService(getCollectionRecord(devCtx, input))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(runService(deleteRecord(devCtx, input))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Once it does, Live's record shows through, and deleting it there leaves Live's in place.
    await f.syncDevelopment([definition], false);
    expect(await runService(getCollectionRecord(devCtx, input))).toEqual(record);
    await runService(deleteRecord(devCtx, input));
    await expect(runService(getCollectionRecord(devCtx, input))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await runService(getCollectionRecord(f.ctx, input))).toEqual(record);
    await f.sync([definition, { ...definition, collectionId: "customers" }]);
    await expect(
      f.live((c) => editRecord(c, { ...input, collectionId: "customers", content: article })),
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
      await expect(f.live((c) => createRecord(c, { ...f.scope, content }))).rejects.toThrow();
    }
    const file = await f.insertFile("real.png");
    const record = await f.live((c) =>
      createRecord(c, { ...f.scope, content: { ...article, cover: { _fileId: file.id } } }),
    );
    expect(record.content.cover).toMatchObject({ url: file.url, filename: file.filename });
    const otherProject = await fixture("validation-other");
    const foreign = await otherProject.insertFile("foreign.png");
    await expect(
      f.live((c) =>
        editRecord(c, {
          ...f.scope,
          id: record.id,
          content: { ...article, cover: { _fileId: foreign.id } },
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("syncs reversibly and authorizes sync", async () => {
    const f = await fixture("sync");
    const unauthorizedSync = (user: typeof f.memberUser | null) =>
      call(
        router.definitions.sync,
        {
          projectUuid: f.project.uuid,
          autoCreate: false,
          definitionSet: { blocks: [], layouts: [], collections: [definition], homepage: null },
        },
        { context: createRpcContext(f.db, user) },
      );
    // Neither anonymous without the deploy token, nor a member naming no development draft.
    await expect(unauthorizedSync(null)).rejects.toThrow();
    await expect(unauthorizedSync(f.memberUser)).rejects.toThrow();
    await expect(f.sync([{ ...definition, label: "cover" }])).rejects.toThrow();
    await expect(f.sync([definition, definition])).rejects.toThrow();
    const record = await f.live((c) => createRecord(c, { ...f.scope, content: article }));
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
