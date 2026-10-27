import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createProjectFixture,
  createServiceContext,
  seedLiveThrough,
  inScope,
  startDraft,
  syncDefinitionSet,
} from "../../../test/fixtures";
import type { Database } from "../../db";
import { runService } from "../../lib/run-service";
import { blockDefinitions, blocks, files, pages } from "../../schema";
import { createBlock, getBlock, getPageMarkdown, updateBlockContent } from "../blocks/service";
import type { ResolvedReference, ResolvedReferences } from "../content/reader";
import * as overlay from "../drafts/overlay";
import { RELEASE } from "../drafts/scope";
import { getLayout } from "../layouts/service";
import { getPageByPath } from "../pages/service";
import {
  createRepeatableItem,
  updateRepeatableItemContent,
  updateRepeatableItemSettings,
} from "../repeatable-items/service";
import { validateReferenceSchema } from "./references";
import { collectionRecords } from "./schema";
import { createRecord, deleteRecord, editRecord, getCollectionRecord } from "./service";

/**
 * Deletes a record from Live through the overlay's release mode. Publishing refuses to leave
 * Live's references to a record dangling (ADR 0009), yet reads still treat a missing record as
 * empty, as for references a release left dangling.
 */
const deleteFromLive = (db: Database, id: string) =>
  runService(overlay.remove(db, RELEASE, collectionRecords, id));

/** The testimonial's (or a logo's) single reference. */
const customer = (owner: { references: ResolvedReferences }) =>
  owner.references.customer as ResolvedReference | null;

/** The message `validateReferenceSchema` rejects `schema` with. */
const rejectionOf = (schema: unknown, allow = true) =>
  Effect.runSync(Effect.flip(validateReferenceSchema(schema, allow))).message;
const OUTSIDE_CONTENT =
  "References and reference lists are only supported in block and item content";

async function fixture(assets = false) {
  const f = await createProjectFixture(`references-${crypto.randomUUID()}`);
  const ctx = createServiceContext(f.db, f.memberUser);
  const publicCtx = createServiceContext(f.db, null);
  const scope = { projectUuid: f.project.uuid, collectionId: "customers" };
  // Content writes reach Live by publishing a throwaway draft (ADR 0009).
  const live = <A>(run: Parameters<typeof seedLiveThrough<A>>[2]) =>
    seedLiveThrough(ctx, f.project.id, run);
  await syncDefinitionSet(f.db, f.project, {
    collections: [
      {
        collectionId: "customers",
        title: "Customers",
        description: "",
        toTitle: "{{name}}",
        toDescription: null,
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
  const record = await live((_draft, c) =>
    createRecord(c, {
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
      layoutId: f.layout.layoutId,
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
    blockId: "testimonial",
    title: "Testimonial",
    description: "",
    contentSchema: schema,
    createdAt: 1,
    updatedAt: 1,
  });
  const block = await live((draft) =>
    createBlock(inScope(ctx, draft), {
      pageId: page.id,
      type: "testimonial",
      content: { customer: record.id },
    }),
  );
  return { ...f, ctx, publicCtx, scope, live, record, page, block, schema };
}

describe("single collection references", () => {
  it("resolves a referenced record's image and file from the current file on every read", async () => {
    const f = await fixture(true);
    const managed = await f.db
      .insert(files)
      .values([
        {
          projectId: f.project.id,
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
    await f.live((_draft, c) =>
      editRecord(c, {
        ...f.scope,
        id: f.record.id,
        content: {
          name: "Original",
          logo: { _fileId: managed[0].id },
          document: { _fileId: managed[1].id },
        },
      }),
    );
    // A file change shows on every read of the record, with no edit to the record.
    await f.db
      .update(files)
      .set({ url: "https://assets.example.com/replaced.png", alt: "Changed" })
      .where(eq(files.id, managed[0].id));
    for (const ctx of [f.ctx, f.publicCtx]) {
      const block = await runService(getBlock(inScope(ctx, null), { id: f.block.id }));
      const page = await runService(
        getPageByPath(inScope(ctx, null), { projectUuid: f.project.uuid, path: "/reference" }),
      );
      for (const result of [block, page]) {
        expect(result.files.map((file) => file.id).sort()).toEqual(
          managed.map((file) => file.id).sort(),
        );
      }
      expect(customer(block.block)?.content.logo).toEqual({
        _fileId: managed[0].id,
        url: "https://assets.example.com/replaced.png",
        alt: "Changed",
        filename: "logo.png",
        mimeType: "image/png",
        size: 123,
      });
      const markdown = await runService(getPageMarkdown(inScope(ctx, null), { pageId: f.page.id }));
      expect(markdown.markdown).toContain("![Changed]");
      expect(markdown.markdown).toContain("replaced.png");
      expect(markdown.markdown).toContain("[report.pdf](https://assets.example.com/report.pdf)");
      expect(markdown.markdown).not.toContain("Library logo");
    }
    await f.db
      .update(blocks)
      .set({ pageId: null, layoutId: f.layout.layoutId, slot: "before" })
      .where(eq(blocks.id, f.block.id));
    for (const ctx of [f.ctx, f.publicCtx]) {
      const layout = await runService(
        getLayout(inScope(ctx, null), { projectUuid: f.project.uuid, layoutId: "default" }),
      );
      expect(layout.files.map((file) => file.id).sort()).toEqual(
        managed.map((file) => file.id).sort(),
      );
      expect(customer(layout.blocks[0])?.content.document).toMatchObject({
        _fileId: managed[1].id,
        url: "https://assets.example.com/report.pdf",
      });
      expect(
        (await runService(getPageMarkdown(inScope(ctx, null), { pageId: f.page.id }))).markdown,
      ).toContain("[report.pdf](https://assets.example.com/report.pdf)");
    }
  });

  it("stores record ids, resolves the record's content for members and visitors, and rejects records out of scope", async () => {
    const f = await fixture();
    for (const ctx of [f.ctx, f.publicCtx]) {
      const read = await runService(getBlock(inScope(ctx, null), { id: f.block.id }));
      expect(read.block.content.customer).toBe(f.record.id);
      expect(read.block.references.customer).toMatchObject({
        id: f.record.id,
        content: { name: "Original" },
      });
    }
    const other = await fixture();
    await expect(
      f.live((draft) =>
        updateBlockContent(inScope(f.ctx, draft), {
          id: f.block.id,
          content: { customer: other.record.id },
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      f.live((draft) =>
        updateBlockContent(inScope(f.ctx, draft), {
          id: f.block.id,
          content: { customer: { id: f.record.id } },
        }),
      ),
    ).rejects.toThrow();
  });

  it("shows a record edit to visitors with no edit to the page", async () => {
    const f = await fixture();
    await f.live((_draft, c) =>
      editRecord(c, { ...f.scope, id: f.record.id, content: { name: "Changed" } }),
    );
    expect(
      (await runService(getPageMarkdown(inScope(f.publicCtx, null), { pageId: f.page.id })))
        .markdown,
    ).toContain("Customer: Changed");
  });

  it("rejects nested references and references without a collection; an empty reference saves", async () => {
    const f = await fixture();
    expect(rejectionOf({ properties: { nested: { properties: f.schema.properties } } })).toBe(
      OUTSIDE_CONTENT,
    );
    expect(rejectionOf({ properties: { list: { fieldType: "ReferenceList" } } })).toBe(
      "Reference requires collectionId",
    );
    await f.live((draft) =>
      updateBlockContent(inScope(f.ctx, draft), { id: f.block.id, content: { customer: null } }),
    );
    expect(
      (await runService(getBlock(inScope(f.ctx, null), { id: f.block.id }))).block.references
        .customer,
    ).toBeNull();
  });

  it("resolves references in layout blocks for members and visitors", async () => {
    const f = await fixture();
    await f.db
      .update(blocks)
      .set({ pageId: null, layoutId: f.layout.layoutId, slot: "before" })
      .where(eq(blocks.id, f.block.id));
    const layoutCustomer = async (ctx: typeof f.ctx) =>
      customer(
        (
          await runService(
            getLayout(inScope(ctx, null), { projectUuid: f.project.uuid, layoutId: "default" }),
          )
        ).blocks[0],
      )?.content.name;
    expect(await layoutCustomer(f.ctx)).toBe("Original");
    expect(await layoutCustomer(f.publicCtx)).toBe("Original");
    await f.live((_draft, c) =>
      editRecord(c, { ...f.scope, id: f.record.id, content: { name: "Changed" } }),
    );
    expect(await layoutCustomer(f.ctx)).toBe("Changed");
    expect(await layoutCustomer(f.publicCtx)).toBe("Changed");
  });

  it("deletes a referenced record, after which the reference reads as empty for members and visitors", async () => {
    const f = await fixture();
    await deleteFromLive(f.db, f.record.id);
    for (const ctx of [f.ctx, f.publicCtx]) {
      const read = await runService(getBlock(inScope(ctx, null), { id: f.block.id }));
      expect(read.block.content.customer).toBe(f.record.id);
      expect(read.block.references.customer).toBeNull();
      expect(
        (await runService(getPageMarkdown(inScope(ctx, null), { pageId: f.page.id }))).markdown,
      ).not.toContain("Original");
    }
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
      f.live((_draft, c) => createRecord(c, { ...f.scope, content: { name } })),
    ),
  );
  await f.db.insert(blockDefinitions).values({
    projectId: f.project.id,
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
  const list = await f.live((draft) =>
    createBlock(inScope(f.ctx, draft), { pageId: f.page.id, type: "logo-grid", content: {} }),
  );
  const setList = (customers: unknown) =>
    f.live((draft) =>
      updateBlockContent(inScope(f.ctx, draft), { id: list.id, content: { customers } }),
    );
  const ids = (references: Record<string, unknown> | undefined) =>
    ((references?.customers ?? []) as { id: string }[]).map((record) => record.id);
  const listIds = async (ctx: typeof f.ctx) =>
    ids((await runService(getBlock(inScope(ctx, null), { id: list.id }))).block.references);
  const listMarkdown = async (ctx: typeof f.ctx) =>
    (await runService(getPageMarkdown(inScope(ctx, null), { pageId: f.page.id }))).markdown;
  return { ...f, alpha: f.record, beta, gamma, list, setList, ids, listIds, listMarkdown };
}

describe("reference lists", () => {
  it("accepts reference lists at the top level of block and item content only", async () => {
    const accepted = { properties: { customers: referenceList() } };
    expect(() => Effect.runSync(validateReferenceSchema(accepted))).not.toThrow();
    for (const [schema, allow, message] of [
      [{ properties: { nested: accepted } }, true, OUTSIDE_CONTENT],
      [
        { properties: { items: { fieldType: "Repeater", itemSettingsSchema: accepted } } },
        true,
        OUTSIDE_CONTENT,
      ],
      [accepted, false, OUTSIDE_CONTENT],
      [
        { properties: { customers: { ...referenceList(), collectionId: undefined } } },
        true,
        "Reference requires collectionId",
      ],
    ] as const) {
      expect(rejectionOf(schema, allow)).toBe(message);
    }
    const f = await fixture();
    await expect(
      syncDefinitionSet(f.db, f.project, {
        collections: [
          {
            collectionId: "partners",
            title: "Partners",
            description: "",
            toTitle: "{{name}}",
            toDescription: null,
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
    ).rejects.toThrow();
  });

  it("stores ordered ids, defaults to empty and rejects out-of-scope, duplicate and overfull lists", async () => {
    const f = await listFixture();
    expect(f.list.content).toEqual({ customers: [] });
    await f.setList([f.gamma.id, f.alpha.id]);
    expect(
      (await runService(getBlock(inScope(f.ctx, null), { id: f.list.id }))).block.content.customers,
    ).toEqual([f.gamma.id, f.alpha.id]);

    const otherProject = await fixture();
    // A record only a draft holds is out of Live's reach.
    const draftId = await startDraft(f.db, f.project.id, f.memberUser.id);
    const draftCtx = { ...f.ctx, draft: { id: draftId, create: false } };
    const draftRecord = await runService(
      createRecord(draftCtx, { ...f.scope, content: { name: "Drafted" } }),
    );
    for (const invalid of [
      [otherProject.record.id],
      [draftRecord.id],
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
    expect(await f.listIds(f.ctx)).toEqual([f.gamma.id, f.alpha.id]);
  });

  it("resolves every record in stored order for members and visitors", async () => {
    const f = await listFixture();
    await f.setList([f.gamma.id, f.beta.id, f.alpha.id]);
    for (const ctx of [f.ctx, f.publicCtx]) {
      expect(await f.listIds(ctx)).toEqual([f.gamma.id, f.beta.id, f.alpha.id]);
      const page = await runService(
        getPageByPath(inScope(ctx, null), { projectUuid: f.project.uuid, path: "/reference" }),
      );
      expect(f.ids(page.blocks.find((block) => block.id === f.list.id)?.references)).toEqual([
        f.gamma.id,
        f.beta.id,
        f.alpha.id,
      ]);
    }
  });

  it("renders each linked record's Markdown in order for members and visitors, and nothing when empty", async () => {
    const f = await listFixture();
    expect(await f.listMarkdown(f.ctx)).toMatch(/<!-- Logo grid -->\nTrusted by:$/);

    await f.setList([f.gamma.id, f.beta.id, f.alpha.id]);
    for (const ctx of [f.ctx, f.publicCtx]) {
      expect(await f.listMarkdown(ctx)).toContain(
        "<!-- Logo grid -->\nTrusted by:\n\n- Logo of Gamma\n- Logo of Beta\n- Logo of Original",
      );
    }
  });

  it("leaves a deleted record out of a reference list for members and visitors", async () => {
    const f = await listFixture();
    await f.setList([f.gamma.id, f.beta.id, f.alpha.id]);
    await deleteFromLive(f.db, f.beta.id);
    for (const ctx of [f.ctx, f.publicCtx]) {
      expect(await f.listIds(ctx)).toEqual([f.gamma.id, f.alpha.id]);
      expect(await f.listMarkdown(ctx)).toContain(
        "Trusted by:\n\n- Logo of Gamma\n- Logo of Original",
      );
    }
  });
});

const itemReference = () => ({
  fieldType: "Reference",
  collectionId: "customers",
  anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
  default: null,
});

/** A repeater whose items each place a customer, with a local emphasis setting. */
async function itemFixture() {
  const f = await listFixture();
  const item = {
    type: "object",
    properties: {
      customer: itemReference(),
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
  const wall = await f.live((draft) =>
    createBlock(inScope(f.ctx, draft), {
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
  const bundle = (ctx: typeof f.ctx) => runService(getBlock(inScope(ctx, null), { id: wall.id }));
  const read = await bundle(f.ctx);
  const logo = read.repeatableItems.find((item) => item.fieldName === "logos")!;
  const quote = read.repeatableItems.find((item) => item.fieldName === "quotes")!;
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
    expect(
      rejectionOf({
        properties: {
          items: {
            fieldType: "Repeater",
            items: { properties: {} },
            itemSettingsSchema: { properties: { customer: reference } },
          },
        },
      }),
    ).toBe(OUTSIDE_CONTENT);
  });

  it("stores item references, resolves them per item and keeps settings local to the placement", async () => {
    const f = await itemFixture();
    expect(f.logo.content).toMatchObject({ customer: f.alpha.id, partners: [f.gamma.id] });
    expect(customer(f.logo)?.content.name).toBe("Original");
    expect((f.logo.references.partners as ResolvedReference[]).map((r) => r.id)).toEqual([
      f.gamma.id,
    ]);
    expect((f.quote.references.speaker as ResolvedReference).id).toBe(f.beta.id);

    await f.live((draft) =>
      updateRepeatableItemSettings(inScope(f.ctx, draft), {
        id: f.logo.id,
        settings: { emphasized: true },
      }),
    );
    await f.live((draft) =>
      updateRepeatableItemContent(inScope(f.ctx, draft), {
        id: f.logo.id,
        content: { customer: f.gamma.id },
      }),
    );
    const read = await f.bundle(f.ctx);
    const logo = read.repeatableItems.find((item) => item.id === f.logo.id)!;
    expect(logo.settings).toEqual({ emphasized: true });
    expect(customer(logo)?.id).toBe(f.gamma.id);
    // Unlinking the placement never touches the record.
    await f.live((draft) =>
      updateRepeatableItemContent(inScope(f.ctx, draft), {
        id: f.logo.id,
        content: { customer: null },
      }),
    );
    expect(
      (await runService(getCollectionRecord(f.ctx, { ...f.scope, id: f.gamma.id }))).content,
    ).toEqual({ name: "Gamma" });
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
        f.live((draft) =>
          updateRepeatableItemContent(inScope(f.ctx, draft), { id: f.logo.id, content }),
        ),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(
      f.live((draft) =>
        createRepeatableItem(inScope(f.ctx, draft), {
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
      f.live((draft) =>
        createBlock(inScope(f.ctx, draft), {
          pageId: f.page.id,
          type: "logo-wall",
          content: { logos: [{ customer: foreign }] },
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "logos[0].customer: reference is missing or outside this collection/project",
    });
    await expect(
      f.live((draft) =>
        updateBlockContent(inScope(f.ctx, draft), {
          id: f.wall.id,
          content: { logos: [{ _itemId: f.logo.id, customer: foreign }] },
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it.each([false, true])(
    "resolves item references for visitors and leaves deleted records out (synced: %s)",
    async (synced) => {
      const f = await itemFixture();
      await f.db
        .update(blockDefinitions)
        .set({ synced })
        .where(eq(blockDefinitions.blockId, "logo-wall"));
      const visitorRead = await f.bundle(f.publicCtx);
      const logo = visitorRead.repeatableItems.find((item) => item.fieldName === "logos")!;
      expect(customer(logo)?.content.name).toBe("Original");
      expect((logo.references.partners as ResolvedReference[]).map((r) => r.id)).toEqual([
        f.gamma.id,
      ]);
      const quote = () =>
        f
          .bundle(f.publicCtx)
          .then(
            (bundle) =>
              bundle.repeatableItems.find((item) => item.fieldName === "quotes")?.references
                .speaker as ResolvedReference | null,
          );
      expect((await quote())?.id).toBe(f.beta.id);
      const page = await runService(
        getPageByPath(inScope(f.publicCtx, null), {
          projectUuid: f.project.uuid,
          path: "/reference",
        }),
      );
      expect(customer(page.repeatableItems.find((item) => item.id === logo.id) as never)?.id).toBe(
        f.alpha.id,
      );

      await deleteFromLive(f.db, f.beta.id);
      expect(await quote()).toBeNull();
    },
  );

  it("renders item references through the repeater's per-item Markdown", async () => {
    const f = await itemFixture();
    expect(await f.listMarkdown(f.ctx)).toContain(
      "<!-- Logo wall -->\nLogos:\n\n- Original\n  - Gamma\n  - Quote by Beta",
    );
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
  // Content writes reach Live by publishing a throwaway draft (ADR 0009).
  const live = <A>(run: Parameters<typeof seedLiveThrough<A>>[2]) =>
    seedLiveThrough(ctx, f.project.id, run);
  const definition = (collectionId: string, properties: Record<string, unknown>) => ({
    collectionId,
    title: collectionId,
    description: "",
    toTitle: "{{name}}",
    toDescription: null,
    contentSchema: {
      type: "object" as const,
      properties: { name: { type: "string", fieldType: "String" as const }, ...properties },
      required: ["name", ...Object.keys(properties)],
      additionalProperties: false as const,
    },
  });
  const teaserDefinition = {
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
  };
  const sync = (definitions: ReturnType<typeof definition>[]) =>
    syncDefinitionSet(f.db, f.project, {
      blocks: [teaserDefinition],
      collections: definitions as never,
    });
  const authorsDefinition = definition("authors", { favorite: collectionReference("articles") });
  const articlesDefinition = definition("articles", {
    author: collectionReference("authors"),
    coauthors: collectionReferenceList("authors"),
  });
  await sync([authorsDefinition, articlesDefinition]);
  const authors = { projectUuid: f.project.uuid, collectionId: "authors" };
  const articles = { projectUuid: f.project.uuid, collectionId: "articles" };
  const jane = await live((_draft, c) =>
    createRecord(c, { ...authors, content: { name: "Jane", favorite: null } }),
  );
  const sam = await live((_draft, c) =>
    createRecord(c, { ...authors, content: { name: "Sam", favorite: null } }),
  );
  const article = await live((_draft, c) =>
    createRecord(c, {
      ...articles,
      content: { name: "Launch", author: jane.id, coauthors: [sam.id] },
    }),
  );
  // Jane's favorite article closes the cycle article → author → article.
  await live((_draft, c) =>
    editRecord(c, {
      ...authors,
      id: jane.id,
      content: { name: "Jane", favorite: article.id },
    }),
  );
  const page = await f.db
    .insert(pages)
    .values({
      projectId: f.project.id,
      layoutId: f.layout.layoutId,
      pathSegment: "relations",
      fullPath: "/relations",
      nickname: "",
      createdAt: 1,
      updatedAt: 1,
      contentUpdatedAt: 1,
    })
    .returning()
    .get();
  const block = await live((draft) =>
    createBlock(inScope(ctx, draft), {
      pageId: page.id,
      type: "article-teaser",
      content: { article: article.id },
    }),
  );
  const teaser = async (reader: typeof ctx) =>
    (await runService(getBlock(inScope(reader, null), { id: block.id }))).block.references
      .article as ResolvedReference | null;
  return {
    live,
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
        f.live((_draft, c) => createRecord(c, { ...f.articles, content })),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    const saved = await f.live((_draft, c) =>
      createRecord(c, {
        ...f.articles,
        content: { name: "x", author: null, coauthors: [f.sam.id, f.jane.id] },
      }),
    );
    expect(saved.content.coauthors).toEqual([f.sam.id, f.jane.id]);
  });

  it("resolves two hops from a block for members and visitors, and stops there through cycles", async () => {
    const f = await relationFixture();
    for (const ctx of [f.ctx, f.publicCtx]) {
      const article = await f.teaser(ctx);
      expect(article?.content.name).toBe("Launch");
      const author = article!.references!.author as ResolvedReference;
      expect(author.content.name).toBe("Jane");
      expect((article!.references!.coauthors as ResolvedReference[]).map((r) => r.id)).toEqual([
        f.sam.id,
      ]);
      // Jane's favorite article is the third hop: never expanded.
      expect(author.references).toBeUndefined();
    }
  });

  it("renders nested reference Markdown through the placement's per-use format", async () => {
    const f = await relationFixture();
    expect(
      (await runService(getPageMarkdown(inScope(f.ctx, null), { pageId: f.page.id }))).markdown,
    ).toContain("Launch by Jane\n\n- Sam");
  });

  it("leaves a deleted record out of the references of records linking it", async () => {
    const f = await relationFixture();
    await deleteFromLive(f.db, f.sam.id);
    await deleteFromLive(f.db, f.jane.id);
    expect((await f.teaser(f.ctx))?.references).toEqual({ author: null, coauthors: [] });
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
    expect(record.content).toMatchObject({ author: f.jane.id, editor: null });
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

type Reader = "member" | "visitor";

/** Runs `run` with the clock at `time`, so records get known creation and edit times. */
async function at<T>(time: number, run: () => Promise<T>) {
  const clock = vi.spyOn(Date, "now").mockReturnValue(time);
  try {
    return await run();
  } finally {
    clock.mockRestore();
  }
}

/**
 * Five articles, created in this order: Bravo, alpha, Charlie, Delta and an untitled one. A
 * page holds one block whose query-backed lists order them in different ways.
 */
async function queryFixture() {
  const f = await createProjectFixture(`queries-${crypto.randomUUID()}`);
  const ctx = createServiceContext(f.db, f.memberUser);
  const publicCtx = createServiceContext(f.db, null);
  // Content writes reach Live by publishing a throwaway draft (ADR 0009).
  const live = <A>(run: Parameters<typeof seedLiveThrough<A>>[2]) =>
    seedLiveThrough(ctx, f.project.id, run);
  const scope = { projectUuid: f.project.uuid, collectionId: "articles" };
  await syncDefinitionSet(f.db, f.project, {
    collections: [
      {
        collectionId: "articles",
        title: "Articles",
        description: "",
        toTitle: "{{title}}",
        toDescription: null,
        contentSchema: articleSchema,
      },
    ],
  });
  const create = (title: string, time: number) =>
    at(time, () =>
      live((_draft, c) =>
        createRecord(c, { ...scope, content: { title, excerpt: `About ${title}`, cover: null } }),
      ),
    );
  const bravo = await create("Bravo", 1000);
  const alpha = await create("alpha", 2000);
  const charlie = await create("Charlie", 3000);
  const delta = await create("Delta", 4000);
  const untitled = await create("", 5000);
  const page = await f.db
    .insert(pages)
    .values({
      projectId: f.project.id,
      layoutId: f.layout.layoutId,
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
    firstByTitle: queryList({ orderBy: { title: "asc" }, limit: 2 }),
    newest: queryList({ orderBy: { createdAt: "desc" }, limit: 2 }),
    firstPublished: queryList({ orderBy: { publishedAt: "asc" }, limit: 4 }),
    recent: queryList({ orderBy: { publishedAt: "desc" }, limit: 3 }, [
      "## {{title}}",
      "{{excerpt}}",
    ]),
  };
  await f.db.insert(blockDefinitions).values({
    projectId: f.project.id,
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
  const block = await live((draft) =>
    createBlock(inScope(ctx, draft), {
      pageId: page.id,
      type: "article-index",
      content: { features: [{}] },
    }),
  );
  const bundle = (reader: Reader) =>
    runService(getBlock(inScope(reader === "member" ? ctx : publicCtx, null), { id: block.id }));
  /** The titles a list resolves to, in order. */
  const titles = async (field: keyof typeof lists, reader: Reader) =>
    ((await bundle(reader)).block.references[field] as ResolvedReference[]).map((r) => r.title);
  const markdown = async (reader: Reader) =>
    (
      await runService(
        getPageMarkdown(inScope(reader === "member" ? ctx : publicCtx, null), { pageId: page.id }),
      )
    ).markdown;
  return {
    live,
    ...f,
    ctx,
    publicCtx,
    scope,
    page,
    block,
    records: { alpha, bravo, charlie, delta, untitled },
    create,
    bundle,
    titles,
    markdown,
  };
}

const readers = ["member", "visitor"] as const;

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
    const read = await f.bundle("member");
    expect(read.block.content).not.toHaveProperty("recent");
    const item = read.repeatableItems[0];
    expect(item.content).not.toHaveProperty("latest");
    const ids = [f.records.alpha.id];
    const rejection = (name: string) => ({
      code: "BAD_REQUEST",
      message: `${name}: query-backed reference lists are resolved, not written`,
    });
    await expect(
      f.live((draft) =>
        updateBlockContent(inScope(f.ctx, draft), { id: f.block.id, content: { recent: ids } }),
      ),
    ).rejects.toMatchObject(rejection("recent"));
    await expect(
      f.live((draft) =>
        updateBlockContent(inScope(f.ctx, draft), { id: f.block.id, content: { recent: [] } }),
      ),
    ).rejects.toMatchObject(rejection("recent"));
    await expect(
      f.live((draft) =>
        createBlock(inScope(f.ctx, draft), {
          pageId: f.page.id,
          type: "article-index",
          content: { byTitle: ids },
        }),
      ),
    ).rejects.toMatchObject(rejection("byTitle"));
    await expect(
      f.live((draft) =>
        createBlock(inScope(f.ctx, draft), {
          pageId: f.page.id,
          type: "article-index",
          content: { features: [{ latest: ids }] },
        }),
      ),
    ).rejects.toMatchObject(rejection("features[0].latest"));
    await expect(
      f.live((draft) =>
        updateRepeatableItemContent(inScope(f.ctx, draft), {
          id: item.id,
          content: { latest: ids },
        }),
      ),
    ).rejects.toMatchObject(rejection("latest"));
    await expect(
      f.live((draft) =>
        createRepeatableItem(inScope(f.ctx, draft), {
          blockId: f.block.id,
          fieldName: "features",
          content: { latest: ids },
        }),
      ),
    ).rejects.toMatchObject(rejection("latest"));
  });

  it("orders every record by its current content, the same for members and visitors", async () => {
    const f = await queryFixture();
    for (const reader of readers) {
      // Case-insensitive text order; empty text sorts last in either direction.
      expect(await f.titles("byTitle", reader)).toEqual(["alpha", "Bravo", "Charlie", "Delta", ""]);
      expect(await f.titles("byTitleDesc", reader)).toEqual([
        "Delta",
        "Charlie",
        "Bravo",
        "alpha",
        "",
      ]);
      expect(await f.titles("byCreation", reader)).toEqual([
        "Bravo",
        "alpha",
        "Charlie",
        "Delta",
        "",
      ]);
      // Without orderBy, records keep creation order.
      expect(await f.titles("unordered", reader)).toEqual([
        "Bravo",
        "alpha",
        "Charlie",
        "Delta",
        "",
      ]);
    }

    // A title change re-sorts the list for everyone, with no edit to the page.
    await f.live((_draft, c) =>
      editRecord(c, {
        ...f.scope,
        id: f.records.bravo.id,
        content: { title: "Zulu", excerpt: "", cover: null },
      }),
    );
    for (const reader of readers) {
      expect(await f.titles("byTitle", reader)).toEqual(["alpha", "Charlie", "Delta", "Zulu", ""]);
    }
  });

  it("orders by publishedAt like creation time, and editing a record never reorders it", async () => {
    const f = await queryFixture();
    const expectOrder = async () => {
      for (const reader of readers) {
        expect(await f.titles("recent", reader)).toEqual(["", "Delta", "Charlie"]);
        expect(await f.titles("firstPublished", reader)).toEqual([
          "Bravo",
          "alpha",
          "Charlie",
          "Delta",
        ]);
      }
    };
    await expectOrder();
    // The oldest record, edited last, keeps its place.
    await at(50_000, () =>
      f.live((_draft, c) =>
        editRecord(c, {
          ...f.scope,
          id: f.records.bravo.id,
          content: { title: "Bravo", excerpt: "Edited", cover: null },
        }),
      ),
    );
    await expectOrder();
  });

  it("compares text case-insensitively, breaking equal text by id in either direction", async () => {
    const f = await queryFixture();
    const lower = await f.create("echo", 6000);
    const upper = await f.create("Echo", 7000);
    const tied = [lower, upper].map(({ id }) => id).sort();
    const ids = async (field: "byTitle" | "byTitleDesc") =>
      ((await f.bundle("member")).block.references[field] as ResolvedReference[])
        .map(({ id }) => id)
        .filter((id) => tied.includes(id));
    expect(await ids("byTitle")).toEqual(tied);
    expect(await ids("byTitleDesc")).toEqual(tied);
  });

  it("applies limits after ordering by text or creation, for members and visitors", async () => {
    const f = await queryFixture();
    for (const reader of readers) {
      expect(await f.titles("firstByTitle", reader)).toEqual(["alpha", "Bravo"]);
      expect(await f.titles("newest", reader)).toEqual(["", "Delta"]);
    }
    // Equal creation times break by id ascending, whatever the direction.
    const twins = [await f.create("Twin", 9000), await f.create("Twin", 9000)];
    const expected = twins
      .map(({ id }) => id)
      .sort()
      .map((id) => ({ id }));
    for (const reader of readers) {
      expect((await f.bundle(reader)).block.references.newest).toMatchObject(expected);
    }
  });

  it("applies limit and caps lists without one at 100 records", async () => {
    const f = await queryFixture();
    expect(await f.titles("recent", "member")).toHaveLength(3);
    // Seed the 96 extra records in one statement: going through createRecord one at a time
    // (each mocking the clock) takes seconds, and record creation is covered elsewhere.
    const { projectId, collectionId } = await f.db
      .select({
        projectId: collectionRecords.projectId,
        collectionId: collectionRecords.collectionId,
      })
      .from(collectionRecords)
      .where(eq(collectionRecords.id, f.records.bravo.id))
      .get()
      .then((row) => row!);
    await f.db.run(sql`
      WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 95)
      INSERT INTO collection_records (id, project_id, collection_id, content, created_at, updated_at)
      SELECT lower(printf('%s-%s-7%s-a%s-%s', hex(randomblob(4)), hex(randomblob(2)),
          substr(hex(randomblob(2)), 2), substr(hex(randomblob(2)), 2), hex(randomblob(6)))),
        ${projectId}, ${collectionId},
        json_object('title', 'Extra ' || i, 'excerpt', '', 'cover', json('null')), 10 + i, 10 + i
      FROM n
    `);
    // 101 records exist; the list without a limit stops at the cap.
    expect(await f.titles("byCreation", "member")).toHaveLength(100);
    expect((await f.titles("byCreation", "member"))[0]).toBe("Extra 0");
    // Numbers within text sort by value.
    const extras = (await f.titles("byTitle", "member")).filter((title) => title.startsWith("E"));
    expect(extras.slice(0, 3)).toEqual(["Extra 0", "Extra 1", "Extra 2"]);
    expect(extras.at(-1)).toBe("Extra 95");
  });

  it("updates visitors' list membership when a record is created or deleted, with no edit to the page", async () => {
    const f = await queryFixture();
    await f.create("Echo", 6000);
    expect(await f.titles("recent", "visitor")).toEqual(["Echo", "", "Delta"]);
    await f.live((_draft, c) => deleteRecord(c, { ...f.scope, id: f.records.alpha.id }));
    for (const reader of readers) {
      expect(await f.titles("byTitle", reader)).toEqual(["Bravo", "Charlie", "Delta", "Echo", ""]);
    }
    const live = await runService(
      getPageByPath(inScope(f.publicCtx, null), { projectUuid: f.project.uuid, path: "/articles" }),
    );
    const block = live.blocks.find((candidate) => candidate.id === f.block.id)!;
    expect((block.references.byTitle as ResolvedReference[]).map((r) => r.title)).toEqual([
      "Bravo",
      "Charlie",
      "Delta",
      "Echo",
      "",
    ]);
  });

  it("ignores ids stored on a list before it became query-backed", async () => {
    const f = await queryFixture();
    await f.db
      .update(blocks)
      .set({ content: { recent: [f.records.bravo.id] } })
      .where(eq(blocks.id, f.block.id));
    for (const reader of readers) {
      expect(await f.titles("recent", reader)).toEqual(["", "Delta", "Charlie"]);
    }
  });

  it("resolves query-backed lists in repeatable items for members and visitors", async () => {
    const f = await queryFixture();
    const latest = async (reader: Reader) =>
      ((await f.bundle(reader)).repeatableItems[0].references.latest as ResolvedReference[]).map(
        (record) => record.title,
      );
    await f.create("Late", 6000);
    for (const reader of readers) {
      expect(await latest(reader)).toEqual(["Late"]);
    }
  });

  it("renders each resolved record through the per-use Markdown for members and visitors", async () => {
    const f = await queryFixture();
    for (const reader of readers) {
      const markdown = await f.markdown(reader);
      expect(markdown).toContain("- ## Delta\n  About Delta\n- ## Charlie\n  About Charlie");
      expect(markdown).not.toContain("About Bravo");
    }
  });
});
