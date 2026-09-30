import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { blockDefinitions, blocks, files, pages } from "../../schema";
import { createBlock, getBlock, getPageMarkdown, updateBlockContent } from "../blocks/service";
import { getLayout, publishLayout } from "../layouts/service";
import { getPageByPath, listPages, publishPage } from "../pages/service";
import { referenceTargets } from "./reference-publication";
import { validateReferenceSchema, validateReferenceValues } from "./references";
import { collectionRecords } from "./schema";
import {
  createRecord,
  deleteRecord,
  editRecord,
  publishRecord,
  readRecord,
  syncCollectionDefinitions,
  unpublishRecord,
} from "./service";

async function fixture(required = false, assets = false) {
  const f = await createProjectFixture(`references-${crypto.randomUUID()}`);
  const ctx = createServiceContext(f.db, f.memberUser);
  const publicCtx = createServiceContext(f.db, null);
  const scope = { projectSlug: f.project.slug, collectionId: "customers" };
  await syncCollectionDefinitions(publicCtx, {
    projectSlug: f.project.slug,
    deployToken: "test-deploy-token",
    autoCreate: false,
    definitions: [
      {
        collectionId: "customers",
        title: "Customers",
        description: "",
        label: "name",
        contentSchema: {
          type: "object",
          properties: {
            name: { type: "string", fieldType: "String" },
            ...(assets
              ? {
                  logo: { type: "object", fieldType: "Image" as const },
                  document: { type: "object", fieldType: "File" as const },
                }
              : {}),
          },
          required: assets ? ["name", "logo", "document"] : ["name"],
          additionalProperties: false,
        },
      },
    ],
  });
  const record = await createRecord(ctx, {
    ...scope,
    content: {
      name: "Original",
      ...(assets ? { logo: null, document: null } : {}),
    },
  });
  const page = await f.db
    .insert(pages)
    .values({
      projectId: f.project.id,
      environmentId: f.environment.id,
      layoutId: f.layout.id,
      pathSegment: "reference",
      fullPath: "/reference",
      nickname: "",
      createdAt: 1,
      updatedAt: 1,
      contentUpdatedAt: 1,
    })
    .returning()
    .get();
  const schema = {
    type: "object",
    properties: {
      customer: {
        fieldType: "Reference",
        collectionId: "customers",
        required,
        anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
        default: null,
      },
    },
    required: ["customer"],
    additionalProperties: false,
    toMarkdown: assets
      ? ["{{customer.logo}}", "{{customer.document}}"]
      : ["Customer: {{customer.name}}"],
  };
  await f.db.insert(blockDefinitions).values({
    projectId: f.project.id,
    environmentId: f.environment.id,
    blockId: "testimonial",
    title: "Testimonial",
    description: "",
    contentSchema: schema,
    createdAt: 1,
    updatedAt: 1,
  });
  const block = await createBlock(ctx, {
    pageId: page.id,
    type: "testimonial",
    content: { customer: record.id },
  });
  return { ...f, ctx, publicCtx, scope, record, page, block, schema };
}

describe("single collection references", () => {
  it.each([false, true])(
    "repairs one owner after optional references become required (synced: %s)",
    async (synced) => {
      const f = await fixture();
      await f.db
        .update(blockDefinitions)
        .set({ synced })
        .where(eq(blockDefinitions.projectId, f.project.id));
      await updateBlockContent(f.ctx, { id: f.block.id, content: { customer: null } });
      const { id: _id, ...pageData } = f.page;
      const otherPage = await f.db
        .insert(pages)
        .values({
          ...pageData,
          pathSegment: "other",
          fullPath: "/other",
        })
        .returning()
        .get();
      await createBlock(f.ctx, {
        pageId: otherPage.id,
        type: "testimonial",
        content: { customer: null },
      });
      await publishPage(f.ctx, { id: f.page.id });
      await publishPage(f.ctx, { id: otherPage.id });
      await f.db
        .update(blockDefinitions)
        .set({
          contentSchema: {
            ...f.schema,
            properties: { customer: { ...f.schema.properties.customer, required: true } },
          },
        })
        .where(eq(blockDefinitions.projectId, f.project.id));
      await updateBlockContent(f.ctx, { id: f.block.id, content: { customer: f.record.id } });
      await publishPage(f.ctx, {
        id: f.page.id,
        collections: [
          {
            id: f.record.id,
            collectionId: "customers",
            expectedVersion: 1,
          },
        ],
      });
      expect(
        (await getBlock(f.publicCtx, { id: f.block.id, source: "live" })).block.references.customer
          ?.id,
      ).toBe(f.record.id);
    },
  );

  it("rejects a placement insert/update after its validated record is concurrently deleted", async () => {
    const f = await fixture();
    await updateBlockContent(f.ctx, { id: f.block.id, content: { customer: null } });
    await validateReferenceValues(
      f.ctx,
      { projectId: f.project.id, environmentId: f.environment.id },
      f.schema,
      { customer: f.record.id },
    );
    await deleteRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 1 });
    const { id: _id, ...blockData } = f.block;
    await expect(
      f.db.insert(blocks).values({ ...blockData, content: { customer: f.record.id } }),
    ).rejects.toThrow();
    await expect(
      f.db
        .update(blocks)
        .set({ content: { customer: f.record.id } })
        .where(eq(blocks.id, f.block.id)),
    ).rejects.toThrow();
    expect(
      (await f.db.select().from(blocks).where(eq(blocks.id, f.block.id)).get())?.content,
    ).toEqual({ customer: null });
  });

  it("does not retain superseded synced references from raw owner checkpoints", async () => {
    const f = await fixture(true);
    await f.db
      .update(blockDefinitions)
      .set({ synced: true })
      .where(eq(blockDefinitions.projectId, f.project.id));
    const { id: _id, ...pageData } = f.page;
    const otherPage = await f.db
      .insert(pages)
      .values({
        ...pageData,
        pathSegment: "other",
        fullPath: "/other",
      })
      .returning()
      .get();
    await createBlock(f.ctx, {
      pageId: otherPage.id,
      type: "testimonial",
      content: { customer: f.record.id },
    });
    await publishPage(f.ctx, {
      id: f.page.id,
      collections: [
        {
          id: f.record.id,
          collectionId: "customers",
          expectedVersion: 1,
        },
      ],
    });
    await publishPage(f.ctx, { id: otherPage.id });
    const replacement = await createRecord(f.ctx, { ...f.scope, content: { name: "Replacement" } });
    await updateBlockContent(f.ctx, { id: f.block.id, content: { customer: replacement.id } });
    await publishPage(f.ctx, {
      id: otherPage.id,
      collections: [
        {
          id: replacement.id,
          collectionId: "customers",
          expectedVersion: 1,
        },
      ],
    });
    expect(
      (await getBlock(f.publicCtx, { id: f.block.id, source: "live" })).block.references.customer
        ?.id,
    ).toBe(replacement.id);
    await unpublishRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 2 });
    await deleteRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 3 });
  });

  it("includes source image/file identities on every read without replacing immutable asset metadata", async () => {
    const f = await fixture(false, true);
    const managed = await f.db
      .insert(files)
      .values([
        {
          projectId: f.project.id,
          environmentId: f.environment.id,
          url: "https://assets.example.com/logo.png",
          alt: "Library logo",
          filename: "logo.png",
          mimeType: "image/png",
          size: 123,
          blobId: "reference-logo",
          path: "logo.png",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          projectId: f.project.id,
          environmentId: f.environment.id,
          url: "https://assets.example.com/report.pdf",
          alt: "",
          filename: "report.pdf",
          mimeType: "application/pdf",
          size: 456,
          blobId: "reference-report",
          path: "report.pdf",
          createdAt: 1,
          updatedAt: 1,
        },
      ])
      .returning();
    const asset = (file: (typeof managed)[number]) => ({
      _fileId: String(file.id),
      url: file.url,
      alt: file.alt,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
    });
    await editRecord(f.ctx, {
      ...f.scope,
      id: f.record.id,
      expectedVersion: 1,
      content: {
        name: "Original",
        logo: { ...asset(managed[0]), alt: "Authored logo" },
        document: asset(managed[1]),
      },
    });
    await publishPage(f.ctx, {
      id: f.page.id,
      collections: [{ id: f.record.id, collectionId: "customers", expectedVersion: 2 }],
    });
    // File-library metadata is mutable; the published source asset is not.
    await f.db
      .update(files)
      .set({ url: "https://assets.example.com/replaced.png", alt: "Changed" })
      .where(eq(files.id, managed[0].id));
    for (const source of ["draft", "live"] as const) {
      const ctx = source === "draft" ? f.ctx : f.publicCtx;
      const block = await getBlock(ctx, { id: f.block.id, source });
      const page = await getPageByPath(ctx, {
        projectSlug: f.project.slug,
        path: "/reference",
        source,
      });
      for (const result of [block, page]) {
        expect(result.files.map((file) => file.id).sort((a, b) => a - b)).toEqual(
          managed.map((file) => file.id).sort((a, b) => a - b),
        );
      }
      expect(block.block.references.customer?.content.logo).toMatchObject({
        _fileId: String(managed[0].id),
        url: managed[0].url,
        alt: "Authored logo",
      });
      const markdown = await getPageMarkdown(ctx, { pageId: f.page.id, source });
      expect(markdown.markdown).toContain("![Authored logo]");
      expect(markdown.markdown).toContain("logo.png");
      expect(markdown.markdown).toContain("[report.pdf](https://assets.example.com/report.pdf)");
      expect(markdown.markdown).not.toContain("replaced.png");
    }
    await f.db
      .update(blocks)
      .set({ pageId: null, layoutId: f.layout.id, placement: "before" })
      .where(eq(blocks.id, f.block.id));
    await publishLayout(f.ctx, { id: f.layout.id });
    for (const source of ["draft", "live"] as const) {
      const ctx = source === "draft" ? f.ctx : f.publicCtx;
      const layout = await getLayout(ctx, {
        projectSlug: f.project.slug,
        layoutId: "default",
        source,
      });
      expect(layout.files.map((file) => file.id).sort((a, b) => a - b)).toEqual(
        managed.map((file) => file.id).sort((a, b) => a - b),
      );
      expect(layout.blocks[0].references.customer?.content.document).toMatchObject({
        _fileId: String(managed[1].id),
        url: managed[1].url,
      });
      expect((await getPageMarkdown(ctx, { pageId: f.page.id, source })).markdown).toContain(
        "[report.pdf](https://assets.example.com/report.pdf)",
      );
    }
  });

  it("stores UUIDs, resolves scoped drafts separately and never leaks unpublished drafts", async () => {
    const f = await fixture();
    const draft = await getBlock(f.ctx, { id: f.block.id, source: "draft" });
    expect(draft.block.content.customer).toBe(f.record.id);
    expect(draft.block.references.customer).toMatchObject({
      id: f.record.id,
      content: { name: "Original" },
      version: 1,
    });
    await expect(
      getBlock(createServiceContext(f.db, f.outsiderUser), { id: f.block.id, source: "draft" }),
    ).rejects.toThrow();
    await publishPage(f.ctx, { id: f.page.id });
    const live = await getBlock(f.publicCtx, { id: f.block.id, source: "live" });
    expect(live.block.references.customer).toBeNull();
    const other = await fixture();
    await expect(
      updateBlockContent(f.ctx, { id: f.block.id, content: { customer: other.record.id } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      updateBlockContent(f.ctx, { id: f.block.id, content: { customer: { id: f.record.id } } }),
    ).rejects.toThrow();
  });

  it("deduplicates targets, blocks excluded required drafts and atomically publishes selected records", async () => {
    const f = await fixture(true);
    await createBlock(f.ctx, {
      pageId: f.page.id,
      type: "testimonial",
      content: { customer: f.record.id },
    });
    const plan = await referenceTargets(f.ctx, { id: f.page.id }, "page");
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({
      id: f.record.id,
      expectedVersion: 1,
      required: true,
      status: "draft",
    });
    await expect(publishPage(f.ctx, { id: f.page.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await f.db.select().from(pages).where(eq(pages.id, f.page.id)).get())
        ?.livePublishedCheckpointId,
    ).toBeNull();
    await publishPage(f.ctx, {
      id: f.page.id,
      collections: [{ id: f.record.id, collectionId: "customers", expectedVersion: 1 }],
    });
    const live = await getPageByPath(f.publicCtx, {
      projectSlug: f.project.slug,
      path: "/reference",
      source: "live",
    });
    expect(live.blocks[0].references.customer).toMatchObject({
      content: { name: "Original" },
      revisionId: expect.any(String),
    });
    expect(live.blocks[0].references.customer).not.toHaveProperty("version");
    expect(
      (await getPageMarkdown(f.publicCtx, { pageId: f.page.id, source: "live" })).markdown,
    ).toContain("Customer: Original");
    await expect(
      unpublishRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      deleteRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps excluded published revisions, derives modified status and updates all live uses on standalone publication", async () => {
    const f = await fixture();
    const published = await publishRecord(f.ctx, {
      ...f.scope,
      id: f.record.id,
      expectedVersion: 1,
    });
    await publishPage(f.ctx, { id: f.page.id, alsoPublishLayout: true });
    await editRecord(f.ctx, {
      ...f.scope,
      id: f.record.id,
      expectedVersion: published.record.version,
      content: { name: "Changed" },
    });
    expect(
      (await listPages(f.ctx, { projectId: f.project.id })).find((page) => page.id === f.page.id)
        ?.status,
    ).toBe("modified");
    expect(
      (await getPageMarkdown(f.ctx, { pageId: f.page.id, source: "draft" })).markdown,
    ).toContain("Changed");
    await publishPage(f.ctx, { id: f.page.id });
    expect(
      (await getPageMarkdown(f.publicCtx, { pageId: f.page.id, source: "live" })).markdown,
    ).toContain("Original");
    await publishRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 3 });
    expect(
      (await getPageMarkdown(f.publicCtx, { pageId: f.page.id, source: "live" })).markdown,
    ).toContain("Changed");
    expect(
      (await listPages(f.ctx, { projectId: f.project.id })).find((page) => page.id === f.page.id)
        ?.status,
    ).toBe("published");
  });

  it("rolls back every visible pointer when a selected source changes at commit time", async () => {
    const f = await fixture(true);
    const original = f.db.batch.bind(f.db);
    const spy = vi.spyOn(f.db, "batch").mockImplementationOnce(async (statements) => {
      await f.db
        .update(collectionRecords)
        .set({ version: 2 })
        .where(eq(collectionRecords.id, f.record.id));
      return original(statements);
    });
    await expect(
      publishPage(f.ctx, {
        id: f.page.id,
        collections: [
          {
            id: f.record.id,
            collectionId: "customers",
            expectedVersion: 1,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    spy.mockRestore();
    expect(await readRecord(f.publicCtx, { ...f.scope, id: f.record.id })).toBeNull();
    expect(
      (await f.db.select().from(pages).where(eq(pages.id, f.page.id)).get())
        ?.livePublishedCheckpointId,
    ).toBeNull();
  });

  it("rejects lists and nested reference schemas; null required values remain editable but not publishable", async () => {
    const f = await fixture(true);
    expect(() =>
      validateReferenceSchema({ properties: { nested: { properties: f.schema.properties } } }),
    ).toThrow();
    expect(() =>
      validateReferenceSchema({ properties: { list: { fieldType: "ReferenceList" } } }),
    ).toThrow();
    await updateBlockContent(f.ctx, { id: f.block.id, content: { customer: null } });
    expect((await referenceTargets(f.ctx, { id: f.page.id }, "page")).missingRequired).toEqual([
      `${f.block.id}.customer`,
    ]);
    await expect(publishPage(f.ctx, { id: f.page.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await f.db.delete(blocks).where(eq(blocks.id, f.block.id));
    await deleteRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 1 });
  });

  it("includes layout dependencies only when selected and resolves layout reads from the same source", async () => {
    const f = await fixture(true);
    await f.db
      .update(blocks)
      .set({ pageId: null, layoutId: f.layout.id, placement: "before" })
      .where(eq(blocks.id, f.block.id));
    expect((await referenceTargets(f.ctx, { id: f.page.id }, "page")).targets).toHaveLength(0);
    expect(
      (await referenceTargets(f.ctx, { id: f.page.id, alsoPublishLayout: true }, "page")).targets,
    ).toHaveLength(1);
    const draft = await getLayout(f.ctx, {
      projectSlug: f.project.slug,
      layoutId: "default",
      source: "draft",
    });
    expect(draft.blocks[0].references.customer?.content.name).toBe("Original");
    await expect(publishLayout(f.ctx, { id: f.layout.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await publishLayout(f.ctx, {
      id: f.layout.id,
      collections: [{ id: f.record.id, collectionId: "customers", expectedVersion: 1 }],
    });
    const live = await getLayout(f.publicCtx, {
      projectSlug: f.project.slug,
      layoutId: "default",
      source: "live",
    });
    expect(live.blocks[0].references.customer?.content.name).toBe("Original");
    await expect(
      unpublishRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows optional unpublication without substituting drafts but protects references from deletion", async () => {
    const f = await fixture();
    await publishPage(f.ctx, {
      id: f.page.id,
      collections: [{ id: f.record.id, collectionId: "customers", expectedVersion: 1 }],
    });
    await unpublishRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 2 });
    expect(
      (await getBlock(f.publicCtx, { id: f.block.id, source: "live" })).block.references.customer,
    ).toBeNull();
    expect(
      (await getBlock(f.ctx, { id: f.block.id, source: "draft" })).block.references.customer
        ?.content.name,
    ).toBe("Original");
    await expect(
      deleteRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 3 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
