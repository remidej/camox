import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blockDefinitions, blocks, files, pages, repeatableItems } from "../../schema";
import { createBlock, getBlock, getPageMarkdown, updateBlockContent } from "../blocks/service";
import { getLayout, publishLayout } from "../layouts/service";
import { getPageByPath, listPages, publishPage } from "../pages/service";
import {
  createRepeatableItem,
  updateRepeatableItemContent,
  updateRepeatableItemSettings,
} from "../repeatable-items/service";
import { referenceTargets } from "./reference-publication";
import {
  validateReferenceSchema,
  validateReferenceValues,
  type ResolvedReference,
  type ResolvedReferences,
} from "./references";
import { collectionRecords } from "./schema";
import {
  createRecord,
  deleteRecord,
  editRecord,
  getCollectionRecord,
  publishRecord,
  readRecord,
  syncCollectionDefinitions,
  unpublishRecord,
} from "./service";

/** The testimonial's (or a logo's) single reference. */
const customer = (owner: { references: ResolvedReferences }) =>
  owner.references.customer as ResolvedReference | null;

async function fixture(required = false, assets = false) {
  const f = await createProjectFixture(`references-${crypto.randomUUID()}`);
  const ctx = createServiceContext(f.db, f.memberUser);
  const publicCtx = createServiceContext(f.db, null);
  const scope = { projectSlug: f.project.slug, collectionId: "customers" };
  await runService(
    syncCollectionDefinitions(publicCtx, {
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
    }),
  );
  const record = await runService(
    createRecord(ctx, {
      ...scope,
      content: {
        name: "Original",
        ...(assets ? { logo: null, document: null } : {}),
      },
    }),
  );
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
  const block = await runService(
    createBlock(ctx, {
      pageId: page.id,
      type: "testimonial",
      content: { customer: record.id },
    }),
  );
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
      await runService(updateBlockContent(f.ctx, { id: f.block.id, content: { customer: null } }));
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
      await runService(
        createBlock(f.ctx, {
          pageId: otherPage.id,
          type: "testimonial",
          content: { customer: null },
        }),
      );
      await runService(publishPage(f.ctx, { id: f.page.id }));
      await runService(publishPage(f.ctx, { id: otherPage.id }));
      await f.db
        .update(blockDefinitions)
        .set({
          contentSchema: {
            ...f.schema,
            properties: { customer: { ...f.schema.properties.customer, required: true } },
          },
        })
        .where(eq(blockDefinitions.projectId, f.project.id));
      await runService(
        updateBlockContent(f.ctx, { id: f.block.id, content: { customer: f.record.id } }),
      );
      await runService(
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
      );
      expect(
        customer(
          (await runService(getBlock(f.publicCtx, { id: f.block.id, source: "live" }))).block,
        )?.id,
      ).toBe(f.record.id);
    },
  );

  it("rejects a placement insert/update after its validated record is concurrently deleted", async () => {
    const f = await fixture();
    await runService(updateBlockContent(f.ctx, { id: f.block.id, content: { customer: null } }));
    await runService(
      validateReferenceValues(
        f.ctx,
        { projectId: f.project.id, environmentId: f.environment.id },
        f.schema,
        { customer: f.record.id },
      ),
    );
    await runService(deleteRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 1 }));
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
    await runService(
      createBlock(f.ctx, {
        pageId: otherPage.id,
        type: "testimonial",
        content: { customer: f.record.id },
      }),
    );
    await runService(
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
    );
    await runService(publishPage(f.ctx, { id: otherPage.id }));
    const replacement = await runService(
      createRecord(f.ctx, { ...f.scope, content: { name: "Replacement" } }),
    );
    await runService(
      updateBlockContent(f.ctx, { id: f.block.id, content: { customer: replacement.id } }),
    );
    await runService(
      publishPage(f.ctx, {
        id: otherPage.id,
        collections: [
          {
            id: replacement.id,
            collectionId: "customers",
            expectedVersion: 1,
          },
        ],
      }),
    );
    expect(
      customer((await runService(getBlock(f.publicCtx, { id: f.block.id, source: "live" }))).block)
        ?.id,
    ).toBe(replacement.id);
    await runService(unpublishRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 2 }));
    await runService(deleteRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 3 }));
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
    await runService(
      editRecord(f.ctx, {
        ...f.scope,
        id: f.record.id,
        expectedVersion: 1,
        content: {
          name: "Original",
          logo: { ...asset(managed[0]), alt: "Authored logo" },
          document: asset(managed[1]),
        },
      }),
    );
    await runService(
      publishPage(f.ctx, {
        id: f.page.id,
        collections: [{ id: f.record.id, collectionId: "customers", expectedVersion: 2 }],
      }),
    );
    // File-library metadata is mutable; the published source asset is not.
    await f.db
      .update(files)
      .set({ url: "https://assets.example.com/replaced.png", alt: "Changed" })
      .where(eq(files.id, managed[0].id));
    for (const source of ["draft", "live"] as const) {
      const ctx = source === "draft" ? f.ctx : f.publicCtx;
      const block = await runService(getBlock(ctx, { id: f.block.id, source }));
      const page = await runService(
        getPageByPath(ctx, {
          projectSlug: f.project.slug,
          path: "/reference",
          source,
        }),
      );
      for (const result of [block, page]) {
        expect(result.files.map((file) => file.id).sort((a, b) => a - b)).toEqual(
          managed.map((file) => file.id).sort((a, b) => a - b),
        );
      }
      expect(customer(block.block)?.content.logo).toMatchObject({
        _fileId: String(managed[0].id),
        url: managed[0].url,
        alt: "Authored logo",
      });
      const markdown = await runService(getPageMarkdown(ctx, { pageId: f.page.id, source }));
      expect(markdown.markdown).toContain("![Authored logo]");
      expect(markdown.markdown).toContain("logo.png");
      expect(markdown.markdown).toContain("[report.pdf](https://assets.example.com/report.pdf)");
      expect(markdown.markdown).not.toContain("replaced.png");
    }
    await f.db
      .update(blocks)
      .set({ pageId: null, layoutId: f.layout.id, slot: "before" })
      .where(eq(blocks.id, f.block.id));
    await runService(publishLayout(f.ctx, { id: f.layout.id }));
    for (const source of ["draft", "live"] as const) {
      const ctx = source === "draft" ? f.ctx : f.publicCtx;
      const layout = await runService(
        getLayout(ctx, {
          projectSlug: f.project.slug,
          layoutId: "default",
          source,
        }),
      );
      expect(layout.files.map((file) => file.id).sort((a, b) => a - b)).toEqual(
        managed.map((file) => file.id).sort((a, b) => a - b),
      );
      expect(customer(layout.blocks[0])?.content.document).toMatchObject({
        _fileId: String(managed[1].id),
        url: managed[1].url,
      });
      expect(
        (await runService(getPageMarkdown(ctx, { pageId: f.page.id, source }))).markdown,
      ).toContain("[report.pdf](https://assets.example.com/report.pdf)");
    }
  });

  it("stores UUIDs, resolves scoped drafts separately and never leaks unpublished drafts", async () => {
    const f = await fixture();
    const draft = await runService(getBlock(f.ctx, { id: f.block.id, source: "draft" }));
    expect(draft.block.content.customer).toBe(f.record.id);
    expect(draft.block.references.customer).toMatchObject({
      id: f.record.id,
      content: { name: "Original" },
      version: 1,
    });
    await expect(
      runService(
        getBlock(createServiceContext(f.db, f.outsiderUser), { id: f.block.id, source: "draft" }),
      ),
    ).rejects.toThrow();
    await runService(publishPage(f.ctx, { id: f.page.id }));
    const live = await runService(getBlock(f.publicCtx, { id: f.block.id, source: "live" }));
    expect(live.block.references.customer).toBeNull();
    const other = await fixture();
    await expect(
      runService(
        updateBlockContent(f.ctx, { id: f.block.id, content: { customer: other.record.id } }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      runService(
        updateBlockContent(f.ctx, { id: f.block.id, content: { customer: { id: f.record.id } } }),
      ),
    ).rejects.toThrow();
  });

  it("deduplicates targets, blocks excluded required drafts and atomically publishes selected records", async () => {
    const f = await fixture(true);
    await runService(
      createBlock(f.ctx, {
        pageId: f.page.id,
        type: "testimonial",
        content: { customer: f.record.id },
      }),
    );
    const plan = await runService(referenceTargets(f.ctx, { id: f.page.id }, "page"));
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({
      id: f.record.id,
      expectedVersion: 1,
      required: true,
      status: "draft",
    });
    await expect(runService(publishPage(f.ctx, { id: f.page.id }))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      (await f.db.select().from(pages).where(eq(pages.id, f.page.id)).get())
        ?.livePublishedCheckpointId,
    ).toBeNull();
    await runService(
      publishPage(f.ctx, {
        id: f.page.id,
        collections: [{ id: f.record.id, collectionId: "customers", expectedVersion: 1 }],
      }),
    );
    const live = await runService(
      getPageByPath(f.publicCtx, {
        projectSlug: f.project.slug,
        path: "/reference",
        source: "live",
      }),
    );
    expect(live.blocks[0].references.customer).toMatchObject({
      content: { name: "Original" },
      revisionId: expect.any(String),
    });
    expect(live.blocks[0].references.customer).not.toHaveProperty("version");
    expect(
      (await runService(getPageMarkdown(f.publicCtx, { pageId: f.page.id, source: "live" })))
        .markdown,
    ).toContain("Customer: Original");
    await expect(
      runService(unpublishRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 2 })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      runService(deleteRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 2 })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps excluded published revisions, derives modified status and updates all live uses on standalone publication", async () => {
    const f = await fixture();
    const published = await runService(
      publishRecord(f.ctx, {
        ...f.scope,
        id: f.record.id,
        expectedVersion: 1,
      }),
    );
    await runService(publishPage(f.ctx, { id: f.page.id, alsoPublishLayout: true }));
    await runService(
      editRecord(f.ctx, {
        ...f.scope,
        id: f.record.id,
        expectedVersion: published.record.version,
        content: { name: "Changed" },
      }),
    );
    expect(
      (await runService(listPages(f.ctx, { projectId: f.project.id }))).find(
        (page) => page.id === f.page.id,
      )?.status,
    ).toBe("modified");
    expect(
      (await runService(getPageMarkdown(f.ctx, { pageId: f.page.id, source: "draft" }))).markdown,
    ).toContain("Changed");
    await runService(publishPage(f.ctx, { id: f.page.id }));
    expect(
      (await runService(getPageMarkdown(f.publicCtx, { pageId: f.page.id, source: "live" })))
        .markdown,
    ).toContain("Original");
    await runService(publishRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 3 }));
    expect(
      (await runService(getPageMarkdown(f.publicCtx, { pageId: f.page.id, source: "live" })))
        .markdown,
    ).toContain("Changed");
    expect(
      (await runService(listPages(f.ctx, { projectId: f.project.id }))).find(
        (page) => page.id === f.page.id,
      )?.status,
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
      runService(
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
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    spy.mockRestore();
    expect(await runService(readRecord(f.publicCtx, { ...f.scope, id: f.record.id }))).toBeNull();
    expect(
      (await f.db.select().from(pages).where(eq(pages.id, f.page.id)).get())
        ?.livePublishedCheckpointId,
    ).toBeNull();
  });

  it("rejects lists and nested reference schemas; null required values remain editable but not publishable", async () => {
    const f = await fixture(true);
    expect(() =>
      Effect.runSync(
        validateReferenceSchema({ properties: { nested: { properties: f.schema.properties } } }),
      ),
    ).toThrow();
    expect(() =>
      Effect.runSync(
        validateReferenceSchema({ properties: { list: { fieldType: "ReferenceList" } } }),
      ),
    ).toThrow();
    await runService(updateBlockContent(f.ctx, { id: f.block.id, content: { customer: null } }));
    expect(
      (await runService(referenceTargets(f.ctx, { id: f.page.id }, "page"))).missingRequired,
    ).toEqual([`${f.block.id}.customer`]);
    await expect(runService(publishPage(f.ctx, { id: f.page.id }))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await f.db.delete(blocks).where(eq(blocks.id, f.block.id));
    await runService(deleteRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 1 }));
  });

  it("includes layout dependencies only when selected and resolves layout reads from the same source", async () => {
    const f = await fixture(true);
    await f.db
      .update(blocks)
      .set({ pageId: null, layoutId: f.layout.id, slot: "before" })
      .where(eq(blocks.id, f.block.id));
    expect(
      (await runService(referenceTargets(f.ctx, { id: f.page.id }, "page"))).targets,
    ).toHaveLength(0);
    expect(
      (
        await runService(
          referenceTargets(f.ctx, { id: f.page.id, alsoPublishLayout: true }, "page"),
        )
      ).targets,
    ).toHaveLength(1);
    const draft = await runService(
      getLayout(f.ctx, {
        projectSlug: f.project.slug,
        layoutId: "default",
        source: "draft",
      }),
    );
    expect(customer(draft.blocks[0])?.content.name).toBe("Original");
    await expect(runService(publishLayout(f.ctx, { id: f.layout.id }))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await runService(
      publishLayout(f.ctx, {
        id: f.layout.id,
        collections: [{ id: f.record.id, collectionId: "customers", expectedVersion: 1 }],
      }),
    );
    const live = await runService(
      getLayout(f.publicCtx, {
        projectSlug: f.project.slug,
        layoutId: "default",
        source: "live",
      }),
    );
    expect(customer(live.blocks[0])?.content.name).toBe("Original");
    await expect(
      runService(unpublishRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 2 })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows optional unpublication without substituting drafts but protects references from deletion", async () => {
    const f = await fixture();
    await runService(
      publishPage(f.ctx, {
        id: f.page.id,
        collections: [{ id: f.record.id, collectionId: "customers", expectedVersion: 1 }],
      }),
    );
    await runService(unpublishRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 2 }));
    expect(
      (await runService(getBlock(f.publicCtx, { id: f.block.id, source: "live" }))).block.references
        .customer,
    ).toBeNull();
    expect(
      customer((await runService(getBlock(f.ctx, { id: f.block.id, source: "draft" }))).block)
        ?.content.name,
    ).toBe("Original");
    await expect(
      runService(deleteRecord(f.ctx, { ...f.scope, id: f.record.id, expectedVersion: 3 })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

const referenceList = (maxItems?: number) => ({
  type: "array",
  items: { type: "string", format: "uuid" },
  fieldType: "ReferenceList",
  collectionId: "customers",
  title: "Customers",
  default: [],
  ...(maxItems === undefined ? {} : { maxItems }),
});

async function listFixture() {
  const f = await fixture();
  const [beta, gamma] = await Promise.all(
    ["Beta", "Gamma"].map((name) =>
      runService(createRecord(f.ctx, { ...f.scope, content: { name } })),
    ),
  );
  await f.db.insert(blockDefinitions).values({
    projectId: f.project.id,
    environmentId: f.environment.id,
    blockId: "logo-grid",
    title: "Logo grid",
    description: "",
    contentSchema: {
      type: "object",
      properties: { customers: { ...referenceList(3), toMarkdown: ["Logo of {{name}}"] } },
      required: ["customers"],
      additionalProperties: false,
      toMarkdown: ["Trusted by:", "{{customers}}"],
    },
    createdAt: 1,
    updatedAt: 1,
  });
  const list = await runService(
    createBlock(f.ctx, { pageId: f.page.id, type: "logo-grid", content: {} }),
  );
  const setList = (customers: unknown) =>
    runService(updateBlockContent(f.ctx, { id: list.id, content: { customers } }));
  const ids = (references: Record<string, unknown> | undefined) =>
    ((references?.customers ?? []) as { id: string }[]).map((record) => record.id);
  const listIds = async (ctx: typeof f.ctx, source: "draft" | "live") =>
    ids((await runService(getBlock(ctx, { id: list.id, source }))).block.references);
  const listMarkdown = async (ctx: typeof f.ctx, source: "draft" | "live") =>
    (await runService(getPageMarkdown(ctx, { pageId: f.page.id, source }))).markdown;
  return { ...f, alpha: f.record, beta, gamma, list, setList, ids, listIds, listMarkdown };
}

describe("reference lists", () => {
  it("accepts reference lists at the top level of block and item content only", async () => {
    const accepted = { properties: { customers: referenceList() } };
    expect(() => Effect.runSync(validateReferenceSchema(accepted))).not.toThrow();
    for (const [schema, allow] of [
      [{ properties: { nested: accepted } }, true],
      [{ properties: { items: { fieldType: "Repeater", itemSettingsSchema: accepted } } }, true],
      [accepted, false],
      [{ properties: { customers: { ...referenceList(), collectionId: undefined } } }, true],
    ] as const) {
      expect(() => Effect.runSync(validateReferenceSchema(schema, allow))).toThrow();
    }
    const f = await fixture();
    await expect(
      runService(
        syncCollectionDefinitions(f.publicCtx, {
          projectSlug: f.project.slug,
          deployToken: "test-deploy-token",
          autoCreate: false,
          definitions: [
            {
              collectionId: "partners",
              title: "Partners",
              description: "",
              label: "name",
              contentSchema: {
                type: "object",
                properties: {
                  name: { type: "string", fieldType: "String" },
                  customers: referenceList() as never,
                },
                required: ["name", "customers"],
                additionalProperties: false,
              },
            },
          ],
        }),
      ),
    ).rejects.toThrow();
  });

  it("stores ordered ids, defaults to empty and rejects out-of-scope, duplicate and overfull lists", async () => {
    const f = await listFixture();
    expect(f.list.content).toEqual({ customers: [] });
    await f.setList([f.gamma.id, f.alpha.id]);
    expect(
      (await runService(getBlock(f.ctx, { id: f.list.id, source: "draft" }))).block.content
        .customers,
    ).toEqual([f.gamma.id, f.alpha.id]);

    const otherProject = await fixture();
    const devCtx = { ...f.ctx, environmentName: `dev:${f.memberUser.email}` };
    await runService(
      syncCollectionDefinitions(devCtx, {
        projectSlug: f.project.slug,
        autoCreate: true,
        definitions: [
          {
            collectionId: "customers",
            title: "Customers",
            description: "",
            label: "name",
            contentSchema: {
              type: "object",
              properties: { name: { type: "string", fieldType: "String" } },
              required: ["name"],
              additionalProperties: false,
            },
          },
        ],
      }),
    );
    const otherEnvironment = await runService(
      createRecord(devCtx, { ...f.scope, content: { name: "Dev" } }),
    );
    for (const invalid of [
      [otherProject.record.id],
      [otherEnvironment.id],
      [f.alpha.id, f.alpha.id],
      [f.alpha.id, f.beta.id, f.gamma.id, otherProject.record.id],
      ["not-a-uuid"],
      f.alpha.id,
    ]) {
      await expect(f.setList(invalid)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("customers"),
      });
    }
    for (const [invalid, message] of [
      [[f.alpha.id, f.alpha.id], "customers: reference list links the same record more than once"],
      [
        [f.alpha.id, f.beta.id, f.gamma.id, otherProject.record.id],
        "customers: reference list links more than 3 records",
      ],
    ] as const) {
      await expect(f.setList(invalid)).rejects.toMatchObject({ message });
    }
    expect(await f.listIds(f.ctx, "draft")).toEqual([f.gamma.id, f.alpha.id]);
  });

  it("resolves every draft record in order and only published records live, from checkpoints too", async () => {
    const f = await listFixture();
    await runService(publishRecord(f.ctx, { ...f.scope, id: f.alpha.id, expectedVersion: 1 }));
    await runService(publishRecord(f.ctx, { ...f.scope, id: f.gamma.id, expectedVersion: 1 }));
    await f.setList([f.gamma.id, f.beta.id, f.alpha.id]);
    expect(await f.listIds(f.ctx, "draft")).toEqual([f.gamma.id, f.beta.id, f.alpha.id]);

    // An unpublished list record never blocks publishing the page.
    await runService(publishPage(f.ctx, { id: f.page.id }));
    expect(await f.listIds(f.publicCtx, "live")).toEqual([f.gamma.id, f.alpha.id]);
    const live = await runService(
      getPageByPath(f.publicCtx, { projectSlug: f.project.slug, path: "/reference" }),
    );
    expect(f.ids(live.blocks.find((block) => block.id === f.list.id)?.references)).toEqual([
      f.gamma.id,
      f.alpha.id,
    ]);

    // Checkpoints store ids; history resolves them against current published records.
    const checkpointId = (await f.db.select().from(pages).where(eq(pages.id, f.page.id)).get())!
      .livePublishedCheckpointId!;
    await f.setList([]);
    await runService(publishRecord(f.ctx, { ...f.scope, id: f.beta.id, expectedVersion: 1 }));
    const history = await runService(
      getPageByPath(f.ctx, {
        projectSlug: f.project.slug,
        path: "/reference",
        source: { checkpointId },
      }),
    );
    const historyList = history.blocks.find((block) => block.id === f.list.id);
    expect(historyList?.content.customers).toEqual([f.gamma.id, f.beta.id, f.alpha.id]);
    expect(f.ids(historyList?.references)).toEqual([f.gamma.id, f.beta.id, f.alpha.id]);
    expect(await f.listIds(f.ctx, "draft")).toEqual([]);
  });

  it("renders each linked record's Markdown in order, draft or live, and nothing when empty", async () => {
    const f = await listFixture();
    expect(await f.listMarkdown(f.ctx, "draft")).toMatch(/<!-- Logo grid -->\nTrusted by:$/);

    await runService(publishRecord(f.ctx, { ...f.scope, id: f.alpha.id, expectedVersion: 1 }));
    await runService(publishRecord(f.ctx, { ...f.scope, id: f.gamma.id, expectedVersion: 1 }));
    await f.setList([f.gamma.id, f.beta.id, f.alpha.id]);
    expect(await f.listMarkdown(f.ctx, "draft")).toContain(
      "<!-- Logo grid -->\nTrusted by:\n\n- Logo of Gamma\n- Logo of Beta\n- Logo of Original",
    );

    await runService(publishPage(f.ctx, { id: f.page.id }));
    expect(await f.listMarkdown(f.publicCtx, "live")).toContain(
      "<!-- Logo grid -->\nTrusted by:\n\n- Logo of Gamma\n- Logo of Original",
    );
  });

  it("refuses deleting a record linked from a draft or live list but allows unpublishing it", async () => {
    const f = await listFixture();
    await f.setList([f.beta.id]);
    await expect(
      runService(deleteRecord(f.ctx, { ...f.scope, id: f.beta.id, expectedVersion: 1 })),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await runService(publishRecord(f.ctx, { ...f.scope, id: f.beta.id, expectedVersion: 1 }));
    await runService(publishPage(f.ctx, { id: f.page.id }));
    await f.setList([]);
    await runService(unpublishRecord(f.ctx, { ...f.scope, id: f.beta.id, expectedVersion: 2 }));
    await expect(
      runService(deleteRecord(f.ctx, { ...f.scope, id: f.beta.id, expectedVersion: 3 })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await f.listIds(f.publicCtx, "live")).toEqual([]);

    // Once no list links it, it can be deleted; the index then refuses relinking it.
    await runService(publishPage(f.ctx, { id: f.page.id }));
    await runService(deleteRecord(f.ctx, { ...f.scope, id: f.beta.id, expectedVersion: 3 }));
    await expect(
      f.db
        .update(blocks)
        .set({ content: { customers: [f.gamma.id, f.beta.id] } })
        .where(eq(blocks.id, f.list.id)),
    ).rejects.toThrow();
  });

  it("lists each changed linked record once in the publish review, never as required", async () => {
    const f = await listFixture();
    await f.setList([f.beta.id, f.alpha.id]);
    const review = await runService(referenceTargets(f.ctx, { id: f.page.id }, "page"));
    expect(review.missingRequired).toEqual([]);
    expect(review.targets.map((target) => target.id).sort()).toEqual(
      [f.alpha.id, f.beta.id].sort(),
    );
    expect(review.targets.find((target) => target.id === f.beta.id)).toMatchObject({
      required: false,
      status: "draft",
      expectedVersion: 1,
    });
    await runService(
      publishPage(f.ctx, {
        id: f.page.id,
        collections: [{ id: f.beta.id, collectionId: "customers", expectedVersion: 1 }],
      }),
    );
    expect(await f.listIds(f.publicCtx, "live")).toEqual([f.beta.id]);
  });
});

const itemReference = (required = false) => ({
  fieldType: "Reference",
  collectionId: "customers",
  required,
  anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
  default: null,
});

/** A repeater whose items each place a customer, with a local emphasis setting. */
async function itemFixture(required = false) {
  const f = await listFixture();
  const item = {
    type: "object",
    properties: {
      customer: itemReference(required),
      partners: referenceList(2),
      quotes: {
        type: "array",
        fieldType: "Repeater",
        items: {
          type: "object",
          properties: { speaker: itemReference() },
          required: ["speaker"],
        },
        toMarkdown: ["Quote by {{speaker.name}}"],
      },
    },
    required: ["customer", "partners", "quotes"],
  };
  await f.db.insert(blockDefinitions).values({
    projectId: f.project.id,
    environmentId: f.environment.id,
    blockId: "logo-wall",
    title: "Logo wall",
    description: "",
    contentSchema: {
      type: "object",
      properties: {
        logos: {
          type: "array",
          fieldType: "Repeater",
          items: item,
          itemSettingsSchema: {
            type: "object",
            properties: { emphasized: { type: "boolean", fieldType: "Boolean", default: false } },
            required: ["emphasized"],
          },
          toMarkdown: ["{{customer.name}}", "{{partners}}", "{{quotes}}"],
        },
      },
      required: ["logos"],
      additionalProperties: false,
      toMarkdown: ["Logos:", "{{logos}}"],
    },
    createdAt: 1,
    updatedAt: 1,
  });
  const wall = await runService(
    createBlock(f.ctx, {
      pageId: f.page.id,
      type: "logo-wall",
      content: {
        logos: [
          {
            customer: f.alpha.id,
            partners: [f.gamma.id],
            quotes: [{ speaker: f.beta.id }],
          },
        ],
      },
    }),
  );
  const bundle = (ctx: typeof f.ctx, source: "draft" | "live") =>
    runService(getBlock(ctx, { id: wall.id, source }));
  const draft = await bundle(f.ctx, "draft");
  const logo = draft.repeatableItems.find((item) => item.fieldName === "logos")!;
  const quote = draft.repeatableItems.find((item) => item.fieldName === "quotes")!;
  return { ...f, wall, bundle, logo, quote };
}

describe("references in repeatable items", () => {
  it("accepts references in item content at any repeater depth, never in item settings", async () => {
    const reference = itemReference();
    const repeater = (items: unknown) => ({
      properties: { items: { fieldType: "Repeater", items } },
    });
    for (const schema of [
      repeater({ properties: { customer: reference } }),
      repeater({
        properties: { nested: repeater({ properties: { customer: reference } }).properties.items },
      }),
    ]) {
      expect(() => Effect.runSync(validateReferenceSchema(schema))).not.toThrow();
    }
    expect(() =>
      Effect.runSync(
        validateReferenceSchema({
          properties: {
            items: {
              fieldType: "Repeater",
              items: { properties: {} },
              itemSettingsSchema: { properties: { customer: reference } },
            },
          },
        }),
      ),
    ).toThrow();
  });

  it("stores item references, resolves them per item and keeps settings local to the placement", async () => {
    const f = await itemFixture();
    expect(f.logo.content).toMatchObject({ customer: f.alpha.id, partners: [f.gamma.id] });
    expect(customer(f.logo)?.content.name).toBe("Original");
    expect((f.logo.references.partners as ResolvedReference[]).map((r) => r.id)).toEqual([
      f.gamma.id,
    ]);
    expect((f.quote.references.speaker as ResolvedReference).id).toBe(f.beta.id);

    await runService(
      updateRepeatableItemSettings(f.ctx, { id: f.logo.id, settings: { emphasized: true } }),
    );
    await runService(
      updateRepeatableItemContent(f.ctx, { id: f.logo.id, content: { customer: f.gamma.id } }),
    );
    const draft = await f.bundle(f.ctx, "draft");
    const logo = draft.repeatableItems.find((item) => item.id === f.logo.id)!;
    expect(logo.settings).toEqual({ emphasized: true });
    expect(customer(logo)?.id).toBe(f.gamma.id);
    // Unlinking the placement never touches the record.
    await runService(
      updateRepeatableItemContent(f.ctx, { id: f.logo.id, content: { customer: null } }),
    );
    expect(
      (await runService(readRecord(f.ctx, { ...f.scope, id: f.gamma.id, source: "draft" })))?.id,
    ).toBe(f.gamma.id);
  });

  it("rejects out-of-scope, duplicate and overfull item references on every write path", async () => {
    const f = await itemFixture();
    const otherProject = await fixture();
    const foreign = otherProject.record.id;
    for (const content of [
      { customer: foreign },
      { partners: [f.alpha.id, f.alpha.id] },
      { partners: [f.alpha.id, f.beta.id, f.gamma.id] },
    ]) {
      await expect(
        runService(updateRepeatableItemContent(f.ctx, { id: f.logo.id, content })),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(
      runService(
        createRepeatableItem(f.ctx, {
          blockId: f.wall.id,
          fieldName: "logos",
          content: { customer: f.alpha.id },
          nestedItems: [
            {
              tempId: "quote",
              parentTempId: null,
              fieldName: "quotes",
              content: { speaker: foreign },
              position: "a0",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("speaker") });
    await expect(
      runService(
        createBlock(f.ctx, {
          pageId: f.page.id,
          type: "logo-wall",
          content: { logos: [{ customer: foreign }] },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "logos[0].customer: reference is missing or outside this collection/project/environment",
    });
    await expect(
      runService(
        updateBlockContent(f.ctx, {
          id: f.wall.id,
          content: { logos: [{ _itemId: f.logo.id, customer: foreign }] },
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it.each([false, true])(
    "publishes item references with the page and protects their records (synced: %s)",
    async (synced) => {
      const f = await itemFixture(true);
      await f.db
        .update(blockDefinitions)
        .set({ synced })
        .where(eq(blockDefinitions.blockId, "logo-wall"));
      const review = await runService(referenceTargets(f.ctx, { id: f.page.id }, "page"));
      expect(review.targets.map((target) => target.id).sort()).toEqual(
        [f.alpha.id, f.beta.id, f.gamma.id].sort(),
      );
      expect(review.targets.find((target) => target.id === f.alpha.id)?.required).toBe(true);

      // A required item reference left unset blocks publication, like a block's.
      await runService(
        updateRepeatableItemContent(f.ctx, { id: f.logo.id, content: { customer: null } }),
      );
      expect(
        (await runService(referenceTargets(f.ctx, { id: f.page.id }, "page"))).missingRequired,
      ).toEqual([`${f.wall.id}.${f.logo.id}.customer`]);
      await runService(
        updateRepeatableItemContent(f.ctx, { id: f.logo.id, content: { customer: f.alpha.id } }),
      );
      await expect(runService(publishPage(f.ctx, { id: f.page.id }))).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await runService(
        publishPage(f.ctx, {
          id: f.page.id,
          collections: [{ id: f.alpha.id, collectionId: "customers", expectedVersion: 1 }],
        }),
      );
      const live = await f.bundle(f.publicCtx, "live");
      const logo = live.repeatableItems.find((item) => item.fieldName === "logos")!;
      expect(customer(logo)?.content.name).toBe("Original");
      // Unpublished optional records resolve empty live, never as drafts.
      expect(logo.references.partners).toEqual([]);
      expect(
        live.repeatableItems.find((item) => item.fieldName === "quotes")?.references.speaker,
      ).toBeNull();
      const page = await runService(
        getPageByPath(f.publicCtx, { projectSlug: f.project.slug, path: "/reference" }),
      );
      expect(customer(page.repeatableItems.find((item) => item.id === logo.id) as never)?.id).toBe(
        f.alpha.id,
      );

      // A required live item reference cannot be unpublished; linked records cannot be deleted.
      await expect(
        runService(unpublishRecord(f.ctx, { ...f.scope, id: f.alpha.id, expectedVersion: 2 })),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        runService(deleteRecord(f.ctx, { ...f.scope, id: f.beta.id, expectedVersion: 1 })),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    },
  );

  it("renders item references through the repeater's per-item Markdown", async () => {
    const f = await itemFixture();
    expect(await f.listMarkdown(f.ctx, "draft")).toContain(
      "<!-- Logo wall -->\nLogos:\n\n- Original\n  - Gamma\n  - Quote by Beta",
    );
  });

  it("refuses raw item writes linking a deleted record", async () => {
    const f = await itemFixture();
    await f.db.delete(blocks).where(eq(blocks.id, f.list.id));
    await runService(
      updateRepeatableItemContent(f.ctx, { id: f.logo.id, content: { partners: [] } }),
    );
    await runService(deleteRecord(f.ctx, { ...f.scope, id: f.gamma.id, expectedVersion: 1 }));
    await expect(
      f.db
        .update(repeatableItems)
        .set({ content: { customer: f.alpha.id, partners: [f.gamma.id] } })
        .where(eq(repeatableItems.id, f.logo.id)),
    ).rejects.toThrow();
  });
});

const collectionReference = (collectionId: string) => ({
  fieldType: "Reference" as const,
  collectionId,
  anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
  default: null,
});
const collectionReferenceList = (collectionId: string) => ({
  ...referenceList(),
  fieldType: "ReferenceList" as const,
  collectionId,
});

/** Articles link an author and co-authors; authors link a favorite article back (a cycle). */
async function relationFixture() {
  const f = await createProjectFixture(`relations-${crypto.randomUUID()}`);
  const ctx = createServiceContext(f.db, f.memberUser);
  const publicCtx = createServiceContext(f.db, null);
  const definition = (collectionId: string, properties: Record<string, unknown>) => ({
    collectionId,
    title: collectionId,
    description: "",
    label: "name",
    contentSchema: {
      type: "object" as const,
      properties: { name: { type: "string", fieldType: "String" as const }, ...properties },
      required: ["name", ...Object.keys(properties)],
      additionalProperties: false as const,
    },
  });
  const sync = (definitions: ReturnType<typeof definition>[]) =>
    runService(
      syncCollectionDefinitions(publicCtx, {
        projectSlug: f.project.slug,
        deployToken: "test-deploy-token",
        autoCreate: false,
        definitions: definitions as never,
      }),
    );
  const authorsDefinition = definition("authors", { favorite: collectionReference("articles") });
  const articlesDefinition = definition("articles", {
    author: collectionReference("authors"),
    coauthors: collectionReferenceList("authors"),
  });
  await sync([authorsDefinition, articlesDefinition]);
  const authors = { projectSlug: f.project.slug, collectionId: "authors" };
  const articles = { projectSlug: f.project.slug, collectionId: "articles" };
  const jane = await runService(
    createRecord(ctx, { ...authors, content: { name: "Jane", favorite: null } }),
  );
  const sam = await runService(
    createRecord(ctx, { ...authors, content: { name: "Sam", favorite: null } }),
  );
  const article = await runService(
    createRecord(ctx, {
      ...articles,
      content: { name: "Launch", author: jane.id, coauthors: [sam.id] },
    }),
  );
  // Jane's favorite article closes the cycle article → author → article.
  await runService(
    editRecord(ctx, {
      ...authors,
      id: jane.id,
      expectedVersion: 1,
      content: { name: "Jane", favorite: article.id },
    }),
  );
  const page = await f.db
    .insert(pages)
    .values({
      projectId: f.project.id,
      environmentId: f.environment.id,
      layoutId: f.layout.id,
      pathSegment: "relations",
      fullPath: "/relations",
      nickname: "",
      createdAt: 1,
      updatedAt: 1,
      contentUpdatedAt: 1,
    })
    .returning()
    .get();
  await f.db.insert(blockDefinitions).values({
    projectId: f.project.id,
    environmentId: f.environment.id,
    blockId: "article-teaser",
    title: "Article teaser",
    description: "",
    contentSchema: {
      type: "object",
      properties: { article: collectionReference("articles") },
      required: ["article"],
      additionalProperties: false,
      toMarkdown: ["{{article.name}} by {{article.author.name}}", "{{article.coauthors}}"],
    },
    createdAt: 1,
    updatedAt: 1,
  });
  const block = await runService(
    createBlock(ctx, { pageId: page.id, type: "article-teaser", content: { article: article.id } }),
  );
  const teaser = async (source: "draft" | "live") =>
    (await runService(getBlock(source === "draft" ? ctx : publicCtx, { id: block.id, source })))
      .block.references.article as ResolvedReference | null;
  return {
    ...f,
    ctx,
    publicCtx,
    authors,
    articles,
    jane,
    sam,
    article,
    page,
    block,
    teaser,
    sync,
    authorsDefinition,
    articlesDefinition,
    definition,
  };
}

describe("references between collections", () => {
  it("accepts block references to collections that themselves link records", () => {
    const schema = {
      properties: {
        author: {
          ...collectionReference("authors"),
          referenceSchema: { properties: { articles: collectionReferenceList("articles") } },
        },
      },
    };
    expect(() => Effect.runSync(validateReferenceSchema(schema))).not.toThrow();
  });

  it("syncs collection references only to synced collections, never as required", async () => {
    const f = await relationFixture();
    await expect(f.sync([f.articlesDefinition])).rejects.toMatchObject({
      message: 'articles.author: references unknown collection "authors"',
    });
    await expect(
      f.sync([
        f.authorsDefinition,
        f.definition("articles", { author: { ...collectionReference("authors"), required: true } }),
      ]),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("validates record references in scope, ordered and distinct", async () => {
    const f = await relationFixture();
    const other = await relationFixture();
    for (const content of [
      { name: "x", author: other.jane.id, coauthors: [] },
      { name: "x", author: f.article.id, coauthors: [] },
      { name: "x", author: null, coauthors: [f.sam.id, f.sam.id] },
      { name: "x", author: "not-a-uuid", coauthors: [] },
    ]) {
      await expect(
        runService(createRecord(f.ctx, { ...f.articles, content })),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    const saved = await runService(
      createRecord(f.ctx, {
        ...f.articles,
        content: { name: "x", author: null, coauthors: [f.sam.id, f.jane.id] },
      }),
    );
    expect(saved.draft.coauthors).toEqual([f.sam.id, f.jane.id]);
  });

  it("resolves two hops from a block, stops there through cycles, and only published records live", async () => {
    const f = await relationFixture();
    const draft = await f.teaser("draft");
    const author = draft!.references!.author as ResolvedReference;
    expect(author.content.name).toBe("Jane");
    expect((draft!.references!.coauthors as ResolvedReference[]).map((r) => r.id)).toEqual([
      f.sam.id,
    ]);
    // Jane's favorite article is the third hop: never expanded.
    expect(author.references).toBeUndefined();

    await runService(
      publishPage(f.ctx, {
        id: f.page.id,
        collections: [{ id: f.article.id, collectionId: "articles", expectedVersion: 1 }],
      }),
    );
    const live = await f.teaser("live");
    expect(live?.content.name).toBe("Launch");
    expect(live?.references).toEqual({ author: null, coauthors: [] });

    await runService(publishRecord(f.ctx, { ...f.authors, id: f.jane.id, expectedVersion: 2 }));
    expect(((await f.teaser("live"))!.references!.author as ResolvedReference).id).toBe(f.jane.id);
  });

  it("lists second-hop records once in the publish review, never as required", async () => {
    const f = await relationFixture();
    const review = await runService(referenceTargets(f.ctx, { id: f.page.id }, "page"));
    expect(review.targets.every((target) => !target.required)).toBe(true);
    expect(review.targets.map((target) => target.id).sort()).toEqual(
      [f.article.id, f.jane.id, f.sam.id].sort(),
    );
    await runService(
      publishPage(f.ctx, {
        id: f.page.id,
        collections: [
          { id: f.article.id, collectionId: "articles", expectedVersion: 1 },
          { id: f.jane.id, collectionId: "authors", expectedVersion: 2 },
        ],
      }),
    );
    const live = await f.teaser("live");
    expect((live!.references!.author as ResolvedReference).content.name).toBe("Jane");
    expect(
      (await runService(referenceTargets(f.ctx, { id: f.page.id }, "page"))).targets.find(
        (target) => target.id === f.jane.id,
      )?.status,
    ).toBe("published");
  });

  it("renders nested reference Markdown through the placement's per-use format", async () => {
    const f = await relationFixture();
    expect(
      (await runService(getPageMarkdown(f.ctx, { pageId: f.page.id, source: "draft" }))).markdown,
    ).toContain("Launch by Jane\n\n- Sam");
  });

  it("refuses deleting a record another record links, allows unpublishing it, and guards raw writes", async () => {
    const f = await relationFixture();
    await expect(
      runService(deleteRecord(f.ctx, { ...f.authors, id: f.sam.id, expectedVersion: 1 })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await runService(publishRecord(f.ctx, { ...f.authors, id: f.sam.id, expectedVersion: 1 }));
    await runService(unpublishRecord(f.ctx, { ...f.authors, id: f.sam.id, expectedVersion: 2 }));

    // Once no draft or live record links Sam, Sam can be deleted; relinking is then refused.
    await runService(
      editRecord(f.ctx, {
        ...f.articles,
        id: f.article.id,
        expectedVersion: 1,
        content: { name: "Launch", author: f.jane.id, coauthors: [] },
      }),
    );
    await runService(deleteRecord(f.ctx, { ...f.authors, id: f.sam.id, expectedVersion: 3 }));
    await expect(
      f.db
        .update(collectionRecords)
        .set({ draft: { name: "Launch", author: f.jane.id, coauthors: [f.sam.id] } })
        .where(eq(collectionRecords.id, f.article.id)),
    ).rejects.toThrow();
  });

  it("backfills an added reference field as unset on existing records", async () => {
    const f = await relationFixture();
    await f.sync([
      f.authorsDefinition,
      f.definition("articles", {
        author: collectionReference("authors"),
        coauthors: collectionReferenceList("authors"),
        editor: collectionReference("authors"),
      }),
    ]);
    const record = await runService(
      getCollectionRecord(f.ctx, { ...f.articles, id: f.article.id }),
    );
    expect(record.draft).toMatchObject({ author: f.jane.id, editor: null });
  });
});

/** A query-backed list of articles; `orderBy` keys are checked against `referenceSchema`. */
const articleSchema = {
  type: "object" as const,
  properties: {
    title: { type: "string", fieldType: "String" as const },
    excerpt: { type: "string", fieldType: "String" as const },
    cover: { type: "object", fieldType: "Image" as const },
  },
  required: ["title", "excerpt", "cover"],
  additionalProperties: false as const,
};
const queryList = (query: unknown, toMarkdown?: string[]) => ({
  type: "array",
  items: { type: "string", format: "uuid" },
  fieldType: "ReferenceList",
  collectionId: "articles",
  title: "Articles",
  query,
  referenceSchema: articleSchema,
  ...(toMarkdown ? { toMarkdown } : {}),
});

/** Runs `run` with the clock at `time`, so records get known creation and publication times. */
async function at<T>(time: number, run: () => Promise<T>) {
  const clock = vi.spyOn(Date, "now").mockReturnValue(time);
  try {
    return await run();
  } finally {
    clock.mockRestore();
  }
}

/**
 * Five articles: three published (Bravo first, then Charlie, then alpha) and two drafts, one
 * untitled. A page holds one block whose query-backed lists order them in different ways.
 */
async function queryFixture() {
  const f = await createProjectFixture(`queries-${crypto.randomUUID()}`);
  const ctx = createServiceContext(f.db, f.memberUser);
  const publicCtx = createServiceContext(f.db, null);
  const scope = { projectSlug: f.project.slug, collectionId: "articles" };
  await runService(
    syncCollectionDefinitions(publicCtx, {
      projectSlug: f.project.slug,
      deployToken: "test-deploy-token",
      autoCreate: false,
      definitions: [
        {
          collectionId: "articles",
          title: "Articles",
          description: "",
          label: "title",
          contentSchema: articleSchema,
        },
      ],
    }),
  );
  const create = (title: string, time: number) =>
    at(time, () =>
      runService(
        createRecord(ctx, { ...scope, content: { title, excerpt: `About ${title}`, cover: null } }),
      ),
    );
  const bravo = await create("Bravo", 1000);
  const alpha = await create("alpha", 2000);
  const charlie = await create("Charlie", 3000);
  const delta = await create("Delta", 4000);
  const untitled = await create("", 5000);
  const publish = (record: { id: string }, expectedVersion: number, time: number) =>
    at(time, () => runService(publishRecord(ctx, { ...scope, id: record.id, expectedVersion })));
  await publish(bravo, 1, 10_000);
  await publish(charlie, 1, 20_000);
  await publish(alpha, 1, 30_000);
  const page = await f.db
    .insert(pages)
    .values({
      projectId: f.project.id,
      environmentId: f.environment.id,
      layoutId: f.layout.id,
      pathSegment: "articles",
      fullPath: "/articles",
      nickname: "",
      createdAt: 1,
      updatedAt: 1,
      contentUpdatedAt: 1,
    })
    .returning()
    .get();
  const lists = {
    byTitle: queryList({ orderBy: { title: "asc" } }),
    byTitleDesc: queryList({ orderBy: { title: "desc" } }),
    byCreation: queryList({ orderBy: { createdAt: "asc" } }),
    unordered: queryList({}),
    recent: queryList({ orderBy: { publishedAt: "desc" }, limit: 3 }, [
      "## {{title}}",
      "{{excerpt}}",
    ]),
  };
  await f.db.insert(blockDefinitions).values({
    projectId: f.project.id,
    environmentId: f.environment.id,
    blockId: "article-index",
    title: "Article index",
    description: "",
    contentSchema: {
      type: "object",
      properties: {
        ...lists,
        features: {
          type: "array",
          fieldType: "Repeater",
          items: {
            type: "object",
            properties: { latest: queryList({ orderBy: { publishedAt: "desc" }, limit: 1 }) },
            required: ["latest"],
          },
          toMarkdown: ["Latest: {{latest}}"],
        },
      },
      // Like the SDK, every field is listed as required; query-backed lists hold no value.
      required: [...Object.keys(lists), "features"],
      additionalProperties: false,
      toMarkdown: ["Recent:", "{{recent}}"],
    },
    createdAt: 1,
    updatedAt: 1,
  });
  const block = await runService(
    createBlock(ctx, {
      pageId: page.id,
      type: "article-index",
      content: { features: [{}] },
    }),
  );
  await runService(publishPage(ctx, { id: page.id, alsoPublishLayout: true }));
  const bundle = (source: "draft" | "live") =>
    runService(getBlock(source === "draft" ? ctx : publicCtx, { id: block.id, source }));
  /** The titles a list resolves to, in order. */
  const titles = async (field: keyof typeof lists, source: "draft" | "live") =>
    ((await bundle(source)).block.references[field] as ResolvedReference[]).map((r) => r.label);
  const markdown = async (source: "draft" | "live") =>
    (
      await runService(
        getPageMarkdown(source === "draft" ? ctx : publicCtx, { pageId: page.id, source }),
      )
    ).markdown;
  return {
    ...f,
    ctx,
    publicCtx,
    scope,
    page,
    block,
    records: { alpha, bravo, charlie, delta, untitled },
    create,
    publish,
    bundle,
    titles,
    markdown,
  };
}

describe("query-backed reference lists", () => {
  it("accepts typed orderBy keys and capped limits in block and item content only", () => {
    const accepted = (query: unknown) => ({ properties: { articles: queryList(query) } });
    const rejected = (schema: unknown, allow = true) =>
      Effect.runSync(Effect.flip(validateReferenceSchema(schema, allow))).message;
    for (const query of [
      {},
      { orderBy: { title: "asc" } },
      { orderBy: { excerpt: "desc" }, limit: 1 },
      { orderBy: { createdAt: "asc" } },
      { orderBy: { publishedAt: "desc" }, limit: 100 },
    ]) {
      expect(() => Effect.runSync(validateReferenceSchema(accepted(query)))).not.toThrow();
    }
    expect(() =>
      Effect.runSync(
        validateReferenceSchema({
          properties: {
            items: { fieldType: "Repeater", items: accepted({ orderBy: { title: "asc" } }) },
          },
        }),
      ),
    ).not.toThrow();
    for (const [query, message] of [
      [{ orderBy: { cover: "asc" } }, 'articles: cannot order by "cover"'],
      [{ orderBy: { missing: "asc" } }, 'articles: cannot order by "missing"'],
      [{ orderBy: { title: "asc", excerpt: "asc" } }, "articles: orderBy takes a single key"],
      [{ orderBy: {} }, "articles: orderBy takes a single key"],
      [{ orderBy: { title: "up" } }, 'articles: order must be "asc" or "desc"'],
      [{ limit: 101 }, "articles: limit must be an integer from 1 to 100"],
      [{ limit: 0 }, "articles: limit must be an integer from 1 to 100"],
      [{ limit: 2.5 }, "articles: limit must be an integer from 1 to 100"],
      [{ where: { title: "x" } }, "articles: query only supports orderBy and limit"],
      ["recent", "articles: query must be an object"],
    ] as const) {
      expect(rejected(accepted(query))).toBe(message);
    }
    // Settings and single references never carry a query.
    expect(rejected(accepted({}), false)).toBe(
      "References and reference lists are only supported in block and item content",
    );
    expect(
      rejected({
        properties: { article: { ...queryList({}), fieldType: "Reference", type: undefined } },
      }),
    ).toBe("article: only reference lists take a query");
  });

  it("rejects query lists and reserved system field names in collection schemas", async () => {
    const f = await relationFixture();
    const issue = (message: string) => ({
      code: "BAD_REQUEST",
      data: { issues: expect.arrayContaining([expect.objectContaining({ message })]) },
    });
    await expect(
      f.sync([
        f.authorsDefinition,
        f.definition("articles", { latest: { ...collectionReferenceList("authors"), query: {} } }),
      ]),
    ).rejects.toMatchObject(
      issue("latest: query-backed reference lists are not supported in collections"),
    );
    for (const name of ["createdAt", "publishedAt"]) {
      await expect(
        f.sync([
          f.authorsDefinition,
          f.definition("articles", { [name]: { type: "string", fieldType: "String" } }),
        ]),
      ).rejects.toMatchObject(issue(`${name}: reserved field name`));
    }
  });

  it("stores nothing on the block or item and rejects content writes to query-backed lists", async () => {
    const f = await queryFixture();
    const draft = await f.bundle("draft");
    expect(draft.block.content).not.toHaveProperty("recent");
    const item = draft.repeatableItems[0];
    expect(item.content).not.toHaveProperty("latest");
    const ids = [f.records.alpha.id];
    const rejection = (name: string) => ({
      code: "BAD_REQUEST",
      message: `${name}: query-backed reference lists are resolved, not written`,
    });
    await expect(
      runService(updateBlockContent(f.ctx, { id: f.block.id, content: { recent: ids } })),
    ).rejects.toMatchObject(rejection("recent"));
    await expect(
      runService(updateBlockContent(f.ctx, { id: f.block.id, content: { recent: [] } })),
    ).rejects.toMatchObject(rejection("recent"));
    await expect(
      runService(
        createBlock(f.ctx, { pageId: f.page.id, type: "article-index", content: { byTitle: ids } }),
      ),
    ).rejects.toMatchObject(rejection("byTitle"));
    await expect(
      runService(
        createBlock(f.ctx, {
          pageId: f.page.id,
          type: "article-index",
          content: { features: [{ latest: ids }] },
        }),
      ),
    ).rejects.toMatchObject(rejection("features[0].latest"));
    await expect(
      runService(updateRepeatableItemContent(f.ctx, { id: item.id, content: { latest: ids } })),
    ).rejects.toMatchObject(rejection("latest"));
    await expect(
      runService(
        createRepeatableItem(f.ctx, {
          blockId: f.block.id,
          fieldName: "features",
          content: { latest: ids },
        }),
      ),
    ).rejects.toMatchObject(rejection("latest"));
  });

  it("orders draft records by draft content and live records by published content", async () => {
    const f = await queryFixture();
    // Case-insensitive text order; empty text sorts last in either direction.
    expect(await f.titles("byTitle", "draft")).toEqual(["alpha", "Bravo", "Charlie", "Delta", ""]);
    expect(await f.titles("byTitleDesc", "draft")).toEqual([
      "Delta",
      "Charlie",
      "Bravo",
      "alpha",
      "",
    ]);
    expect(await f.titles("byCreation", "draft")).toEqual([
      "Bravo",
      "alpha",
      "Charlie",
      "Delta",
      "",
    ]);
    // Without orderBy, records keep creation order.
    expect(await f.titles("unordered", "draft")).toEqual(await f.titles("byCreation", "draft"));
    // Live resolves published records only.
    expect(await f.titles("byTitle", "live")).toEqual(["alpha", "Bravo", "Charlie"]);
    expect(await f.titles("byCreation", "live")).toEqual(["Bravo", "alpha", "Charlie"]);

    // A draft title change re-sorts the preview, never the live list.
    await runService(
      editRecord(f.ctx, {
        ...f.scope,
        id: f.records.bravo.id,
        expectedVersion: 2,
        content: { title: "Zulu", excerpt: "", cover: null },
      }),
    );
    expect(await f.titles("byTitle", "draft")).toEqual(["alpha", "Charlie", "Delta", "Zulu", ""]);
    expect(await f.titles("byTitle", "live")).toEqual(["alpha", "Bravo", "Charlie"]);
  });

  it("orders by first publication, with never-published drafts as now in preview", async () => {
    const f = await queryFixture();
    const { alpha, bravo, charlie, delta, untitled } = f.records;
    expect(await f.titles("recent", "live")).toEqual(["alpha", "Charlie", "Bravo"]);
    // Never-published drafts sort as published now; equal times break by id.
    const drafts = [delta, untitled].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect((await f.bundle("draft")).block.references.recent).toMatchObject(
      [...drafts, alpha].map(({ id }) => ({ id })),
    );
    // Republishing keeps the first publication time.
    await f.publish(bravo, 2, 40_000);
    expect(await f.titles("recent", "live")).toEqual(["alpha", "Charlie", "Bravo"]);
    // Equal publication times break by id.
    const late = await f.create("Late", 6000);
    await f.publish(late, 1, 30_000);
    const tied = [alpha, late].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect((await f.bundle("live")).block.references.recent).toMatchObject(
      [...tied, charlie].map(({ id }) => ({ id })),
    );
  });

  it("applies limit and caps lists without one at 100 records", async () => {
    const f = await queryFixture();
    expect(await f.titles("recent", "draft")).toHaveLength(3);
    for (let index = 0; index < 96; index++) await f.create(`Extra ${index}`, 10 + index);
    // 101 records exist; the list without a limit stops at the cap.
    expect(await f.titles("byCreation", "draft")).toHaveLength(100);
    expect((await f.titles("byCreation", "draft"))[0]).toBe("Extra 0");
    // Numbers within text sort by value.
    const extras = (await f.titles("byTitle", "draft")).filter((title) => title.startsWith("E"));
    expect(extras.slice(0, 3)).toEqual(["Extra 0", "Extra 1", "Extra 2"]);
    expect(extras.at(-1)).toBe("Extra 95");
  });

  it("updates live membership when a record is published, unpublished or deleted, without republishing the page", async () => {
    const f = await queryFixture();
    await f.publish(f.records.delta, 1, 40_000);
    expect(await f.titles("recent", "live")).toEqual(["Delta", "alpha", "Charlie"]);
    await runService(
      unpublishRecord(f.ctx, { ...f.scope, id: f.records.delta.id, expectedVersion: 2 }),
    );
    expect(await f.titles("recent", "live")).toEqual(["alpha", "Charlie", "Bravo"]);
    // Query membership never blocks deleting or unpublishing a record.
    await runService(
      unpublishRecord(f.ctx, { ...f.scope, id: f.records.alpha.id, expectedVersion: 2 }),
    );
    await runService(
      deleteRecord(f.ctx, { ...f.scope, id: f.records.alpha.id, expectedVersion: 3 }),
    );
    expect(await f.titles("byTitle", "live")).toEqual(["Bravo", "Charlie"]);
    expect(await f.titles("byTitle", "draft")).toEqual(["Bravo", "Charlie", "Delta", ""]);
    const live = await runService(
      getPageByPath(f.publicCtx, { projectSlug: f.project.slug, path: "/articles" }),
    );
    const block = live.blocks.find((candidate) => candidate.id === f.block.id)!;
    expect((block.references.byTitle as ResolvedReference[]).map((r) => r.label)).toEqual([
      "Bravo",
      "Charlie",
    ]);
  });

  it("keeps query results out of the publication review, the dependency index and Modified", async () => {
    const f = await queryFixture();
    const review = await runService(referenceTargets(f.ctx, { id: f.page.id }, "page"));
    expect(review).toEqual({ targets: [], missingRequired: [] });

    const status = async () =>
      (await runService(listPages(f.ctx, { projectId: f.project.id }))).find(
        (page) => page.id === f.page.id,
      )?.status;
    expect(await status()).toBe("published");
    await runService(
      editRecord(f.ctx, {
        ...f.scope,
        id: f.records.alpha.id,
        expectedVersion: 2,
        content: { title: "Changed", excerpt: "", cover: null },
      }),
    );
    expect(await status()).toBe("published");

    // A value stored before the list became query-backed is ignored, and never protects a record.
    await f.db
      .update(blocks)
      .set({ content: { recent: [f.records.delta.id] } })
      .where(eq(blocks.id, f.block.id));
    await runService(publishPage(f.ctx, { id: f.page.id }));
    expect(await f.titles("recent", "live")).toEqual(["alpha", "Charlie", "Bravo"]);
    await runService(
      deleteRecord(f.ctx, { ...f.scope, id: f.records.delta.id, expectedVersion: 1 }),
    );
    expect(await f.titles("byCreation", "draft")).toEqual(["Bravo", "Changed", "Charlie", ""]);
  });

  it("resolves query-backed lists in repeatable items, draft and live", async () => {
    const f = await queryFixture();
    const latest = async (source: "draft" | "live") =>
      ((await f.bundle(source)).repeatableItems[0].references.latest as ResolvedReference[]).map(
        (record) => record.label,
      );
    expect(await latest("live")).toEqual(["alpha"]);
    expect(await latest("draft")).toHaveLength(1);
    expect(await latest("draft")).not.toEqual(["alpha"]);
    await f.publish(f.records.delta, 1, 40_000);
    expect(await latest("live")).toEqual(["Delta"]);
  });

  it("renders each resolved record through the per-use Markdown, draft and live", async () => {
    const f = await queryFixture();
    expect(await f.markdown("live")).toContain(
      "Recent:\n\n- ## alpha\n  About alpha\n- ## Charlie\n  About Charlie\n- ## Bravo\n  About Bravo",
    );
    const draft = await f.markdown("draft");
    expect(draft).toContain("- ## Delta\n  About Delta");
    expect(draft).not.toContain("About Charlie");
  });
});
