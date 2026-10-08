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
